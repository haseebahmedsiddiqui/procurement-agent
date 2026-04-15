import { z } from "zod";
import { getAIClient, MODELS } from "./client";
import { recordAICost } from "./cost-tracker";
import { logger } from "@/lib/logger";
import { connectDB } from "@/lib/db/connection";
import { Item } from "@/lib/db/models/Item";
import { MatchFeedback } from "@/lib/db/models/MatchFeedback";
import type { ExtractedProduct } from "./price-extractor";
import { formatFewShots } from "./few-shot-formatter";
import type { FewShot } from "./few-shot-formatter";

const MatchEvaluationSchema = z.object({
  bestMatchIndex: z.number(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
  warnings: z.array(z.string()).default([]),
});

export type MatchEvaluation = z.infer<typeof MatchEvaluationSchema>;

/**
 * Pull a small number of recent confirmed/rejected matches for this
 * (category, vendor) so the LLM can use them as few-shot examples.
 * Joins MatchFeedback → Item by itemId so we can filter by Item.category.
 */
async function loadFewShots(
  category: string,
  vendorSlug: string,
  limit = 4
): Promise<FewShot[]> {
  try {
    await connectDB();

    // Find items in this category
    const itemsInCategory = await Item.find({ category })
      .select("_id rfqDescription")
      .limit(200)
      .lean();

    if (itemsInCategory.length === 0) return [];

    const itemIdMap = new Map<string, string>();
    for (const it of itemsInCategory) {
      itemIdMap.set(String(it._id), (it.rfqDescription as string) || "");
    }

    const feedback = await MatchFeedback.find({
      vendorSlug,
      itemId: { $in: itemsInCategory.map((i) => i._id) },
      action: { $in: ["confirmed", "rejected"] },
    })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    return feedback
      .map((f) => ({
        rfqDescription: itemIdMap.get(String(f.itemId)) || "",
        productName: (f.originalMatch?.productName as string) || "",
        action: f.action as "confirmed" | "rejected" | "corrected",
      }))
      .filter((f) => f.rfqDescription && f.productName);
  } catch (err) {
    logger.warn({ error: err, category, vendorSlug }, "Few-shot load failed");
    return [];
  }
}

/**
 * Evaluate which extracted product is the best match for the RFQ item.
 * Returns confidence score (0.0-1.0) and reasoning.
 *
 * Uses Sonnet for complex matching — needs to understand context
 * (e.g., "is this marine-grade tape the right match for TAPE SEALING CLOTH?")
 *
 * Pulls recent confirmed/rejected feedback for (category, vendor) and
 * injects them into the prompt as few-shot examples so the LLM can learn
 * from past operator decisions.
 */
export async function evaluateMatch(
  rfqDescription: string,
  normalizedName: string,
  candidates: ExtractedProduct[],
  category: string,
  impaCode?: string,
  vendorSlug?: string
): Promise<MatchEvaluation> {
  if (candidates.length === 0) {
    return {
      bestMatchIndex: -1,
      confidence: 0,
      reasoning: "No candidates to evaluate",
      warnings: ["No search results found"],
    };
  }

  const candidateList = candidates
    .map(
      (c, i) =>
        `${i}: "${c.productName}" — $${c.price} — ID: ${c.productId}${c.inStock ? "" : " [OUT OF STOCK]"}`
    )
    .join("\n");

  // Pull few-shot examples from past feedback (only if we know the vendor)
  const fewShots = vendorSlug
    ? await loadFewShots(category, vendorSlug)
    : [];
  const fewShotBlock = formatFewShots(fewShots);

  const prompt = `You are a maritime procurement matching specialist. Evaluate which product is the best match.

RFQ ITEM:
- Original description: "${rfqDescription}"
- Normalized name: "${normalizedName}"
- Category: ${category}
${impaCode ? `- IMPA Code: ${impaCode}` : ""}
${fewShotBlock}
CANDIDATE PRODUCTS:
${candidateList}

Evaluate the best match. Consider:
1. Does the product match the description? (name, type, size, material)
2. Is the quantity/pack size appropriate?
3. Is it the right grade/quality for ${category} use?
4. Is it in stock?
5. Is the price reasonable for this type of item?

Respond with ONLY valid JSON:
{
  "bestMatchIndex": 0,
  "confidence": 0.85,
  "reasoning": "Brief explanation of why this is the best match",
  "warnings": ["any concerns, e.g. 'pack size may differ', 'not marine-grade'"]
}

Confidence guide:
- 0.9-1.0: Exact match (same brand, size, spec)
- 0.7-0.9: Good match (right product type, close specifications)
- 0.5-0.7: Partial match (similar product, some specs differ)
- 0.3-0.5: Weak match (same category but significant differences)
- 0.0-0.3: Poor match (wrong product or not relevant)

If NO candidate is acceptable, set bestMatchIndex to -1 and confidence to 0.`;

  const client = getAIClient();

  const response = await client.messages.create({
    model: MODELS.reasoning,
    max_tokens: 512,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.info(
    { usage: response.usage, model: MODELS.reasoning },
    "Match evaluation API call"
  );
  recordAICost("match_evaluation", MODELS.reasoning, response.usage);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      bestMatchIndex: 0,
      confidence: 0.5,
      reasoning: "Could not parse AI evaluation — defaulting to first result",
      warnings: ["AI evaluation parse failed"],
    };
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    return MatchEvaluationSchema.parse(parsed);
  } catch {
    return {
      bestMatchIndex: 0,
      confidence: 0.5,
      reasoning: "Could not validate AI evaluation — defaulting to first result",
      warnings: ["AI evaluation validation failed"],
    };
  }
}
