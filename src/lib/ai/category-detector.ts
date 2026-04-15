import { z } from "zod";
import { getAIClient, MODELS } from "./client";
import { recordAICost } from "./cost-tracker";
import { connectDB } from "@/lib/db/connection";
import { Category } from "@/lib/db/models/Category";
import type { ParsedRFQItem } from "@/lib/parsers/rfq-parser";
import { logger } from "@/lib/logger";

// Schema for AI response validation
const CategoryGroupSchema = z.object({
  category: z.enum(["stationery", "deck_engine", "galley_kitchen"]),
  confidence: z.number().min(0).max(1),
  itemIndices: z.array(z.number()),
  reasoning: z.string(),
});

const DetectionResultSchema = z.object({
  primaryCategory: z.enum(["stationery", "deck_engine", "galley_kitchen"]),
  isMixed: z.boolean(),
  overallConfidence: z.number().min(0).max(1),
  groups: z.array(CategoryGroupSchema),
});

export type CategoryGroup = z.infer<typeof CategoryGroupSchema>;
export type DetectionResult = z.infer<typeof DetectionResultSchema>;

/**
 * Use AI to detect which category (or categories) an RFQ belongs to.
 * Reads category detection keywords from DB for context.
 * Handles mixed RFQs by splitting items into groups.
 */
export async function detectCategory(
  items: ParsedRFQItem[]
): Promise<DetectionResult> {
  await connectDB();
  const categories = await Category.find().lean();

  // Build category context from DB
  const categoryContext = categories
    .map(
      (cat) =>
        `- ${cat.slug} ("${cat.name}"): ${cat.description}\n  Keywords: ${cat.detectionKeywords.join(", ")}`
    )
    .join("\n");

  // Build item list for the prompt
  const itemList = items
    .map(
      (item, idx) =>
        `${idx}: ${item.description}${item.impaCode ? ` [IMPA: ${item.impaCode}]` : ""}${item.notes ? ` (${item.notes})` : ""}`
    )
    .join("\n");

  const prompt = `You are a maritime procurement specialist. Analyze these RFQ items and classify them into categories.

CATEGORIES (from database):
${categoryContext}

IMPA CODE RANGES (strong signal):
- 47xxxx = Stationery / Office Supplies
- 39xxxx = Deck stores
- 37xxxx = Engine stores
- 35xxxx = Galley / Kitchen stores

ITEMS TO CLASSIFY:
${itemList}

Respond with ONLY valid JSON matching this structure:
{
  "primaryCategory": "stationery" | "deck_engine" | "galley_kitchen",
  "isMixed": boolean (true if items span multiple categories),
  "overallConfidence": number (0.0-1.0),
  "groups": [
    {
      "category": "stationery" | "deck_engine" | "galley_kitchen",
      "confidence": number (0.0-1.0),
      "itemIndices": [0, 1, 2, ...],
      "reasoning": "brief explanation"
    }
  ]
}

Rules:
- If ALL items belong to one category, return one group with all indices. isMixed = false.
- If items span categories, split into groups. isMixed = true. primaryCategory = the largest group.
- IMPA codes are the strongest signal. Use them first, then descriptions, then keywords.
- Every item index must appear in exactly one group.`;

  const client = getAIClient();

  const response = await client.messages.create({
    model: MODELS.reasoning,
    max_tokens: 1024,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.info(
    { usage: response.usage, model: MODELS.reasoning },
    "Category detection API call"
  );
  recordAICost("category_detection", MODELS.reasoning, response.usage);

  // Extract JSON from response (handle markdown code blocks)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI did not return valid JSON for category detection");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const result = DetectionResultSchema.parse(parsed);

  // Validate all items are accounted for
  const allIndices = result.groups.flatMap((g) => g.itemIndices).sort();
  const expectedIndices = items.map((_, i) => i);
  const missing = expectedIndices.filter((i) => !allIndices.includes(i));

  if (missing.length > 0) {
    logger.warn({ missing }, "Some items were not classified, adding to primary category");
    // Add missing items to the primary group
    const primaryGroup = result.groups.find(
      (g) => g.category === result.primaryCategory
    );
    if (primaryGroup) {
      primaryGroup.itemIndices.push(...missing);
    }
  }

  logger.info(
    {
      primary: result.primaryCategory,
      mixed: result.isMixed,
      confidence: result.overallConfidence,
      groupCount: result.groups.length,
    },
    "Category detection complete"
  );

  return result;
}
