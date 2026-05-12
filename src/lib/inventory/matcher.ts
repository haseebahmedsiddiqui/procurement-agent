import { z } from "zod";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db/connection";
import { InventoryItem } from "@/lib/db/models/InventoryItem";
import { InventoryMatchFeedback } from "@/lib/db/models/InventoryMatchFeedback";
import { getAIClient, MODELS } from "@/lib/ai/client";
import { recordAICost } from "@/lib/ai/cost-tracker";
import { logger } from "@/lib/logger";

export interface InventoryMatchCandidate {
  id: string;
  itemCode: string;
  description: string;
  unitOfMeasure: string;
  rank: "A" | "B" | "C" | "D" | "E" | null;
  derivedUnitCost: number | null;
  isActive: boolean;
  lastSaleDate: Date | null;
  pyrUnits: number;
  pyrSalesUsd: number;
}

export interface InventoryMatchResult {
  primary: InventoryMatchCandidate | null;
  confidence: number;
  reasoning: string;
  alternates: InventoryMatchCandidate[];
}

const TextRankSchema = z.object({
  bestIndex: z.number().int(),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

/**
 * Search internal inventory for SKUs that look like a fit for an RFQ line.
 *
 * Two-stage pipeline:
 *   1. Mongo text index on `description` → up to 8 candidates. Cheap.
 *   2. Haiku call to pick the best fit and score 0-1. If the text-search
 *      score gap between the top candidate and second is extreme, we trust
 *      it without the AI call to save latency on obvious matches.
 *
 * Returns confidence so the UI can decide how prominently to show it
 * (≥0.7 = strong badge, 0.4-0.7 = "possible", <0.4 = hide).
 */
export async function matchInventoryItem(input: {
  rfqDescription: string;
  normalizedName: string;
  impaCode?: string;
  ownerId?: string | null;
}): Promise<InventoryMatchResult> {
  await connectDB();
  const ownerId = input.ownerId ?? null;

  // ---- Step 0: short-circuit on prior user feedback for this RFQ line ----
  // Look up confirmed / manual decisions first — if found, return that SKU
  // immediately at confidence 1.0 without an AI call. Also collect any
  // "rejected" SKUs so we can filter them out of the candidate set below.
  const feedback = await InventoryMatchFeedback.find({
    ownerId,
    $or: [
      { rfqDescription: input.rfqDescription },
      ...(input.impaCode ? [{ impaCode: input.impaCode }] : []),
    ],
  }).lean();

  const approvedFeedback = feedback.find(
    (f) => f.action === "confirmed" || f.action === "manual"
  );

  if (approvedFeedback) {
    const item = await InventoryItem.findById(
      approvedFeedback.inventoryItemId
    ).lean();
    if (item) {
      logger.info(
        {
          rfqDescription: input.rfqDescription,
          itemCode: approvedFeedback.itemCode,
          source: approvedFeedback.action,
        },
        "Inventory match short-circuited from feedback"
      );
      return {
        primary: docToCandidate(item),
        confidence: 1.0,
        reasoning: `Previously ${approvedFeedback.action} for this RFQ line`,
        alternates: [],
      };
    }
    // Feedback referenced a SKU that no longer exists — fall through to fresh match.
  }

  const rejectedIds = new Set(
    feedback
      .filter((f) => f.action === "rejected")
      .map((f) => String(f.inventoryItemId))
  );

  // ---- Step 1: text search candidates ----
  const query = `${input.rfqDescription} ${input.normalizedName}`.trim();
  if (!query) return emptyResult();

  const filter: Record<string, unknown> = {
    $text: { $search: query },
    isMasked: false,
    isActive: true,
    ownerId,
  };

  // Pull a few extra in case some are filtered out as rejected.
  const fetchLimit = rejectedIds.size > 0 ? 8 + rejectedIds.size : 8;
  const rawDocs = await InventoryItem.find(filter, {
    score: { $meta: "textScore" },
  })
    .sort({ score: { $meta: "textScore" } })
    .limit(fetchLimit)
    .lean();

  // Drop rejected SKUs from the candidate set
  const docs = rawDocs.filter(
    (d) => !rejectedIds.has(String((d as { _id: Types.ObjectId })._id))
  );

  if (docs.length === 0) {
    return emptyResult();
  }

  const candidates: InventoryMatchCandidate[] = docs.map(docToCandidate);

  // ---- Step 2: AI re-rank ----
  if (candidates.length === 1) {
    return await aiScore(input.rfqDescription, candidates);
  }

  const topScore = (docs[0] as { score?: number }).score ?? 0;
  const secondScore = (docs[1] as { score?: number }).score ?? 0;
  if (topScore > 0 && secondScore > 0 && topScore / secondScore > 2.5) {
    return await aiScore(input.rfqDescription, candidates.slice(0, 3));
  }

  return await aiScore(input.rfqDescription, candidates.slice(0, 5));
}

function docToCandidate(
  d: Record<string, unknown> | null | undefined
): InventoryMatchCandidate {
  const doc = d ?? {};
  return {
    id: String((doc as { _id: Types.ObjectId })._id),
    itemCode: (doc.itemCode as string) ?? "",
    description: (doc.description as string) ?? "",
    unitOfMeasure: (doc.unitOfMeasure as string) || "",
    rank: (doc.rank as InventoryMatchCandidate["rank"]) ?? null,
    derivedUnitCost: (doc.derivedUnitCost as number | null) ?? null,
    isActive: Boolean(doc.isActive),
    lastSaleDate: doc.lastSaleDate ? new Date(doc.lastSaleDate as Date) : null,
    pyrUnits:
      (doc.sales as { pyr?: { units?: number } } | undefined)?.pyr?.units ?? 0,
    pyrSalesUsd:
      (doc.sales as { pyr?: { salesUsd?: number } } | undefined)?.pyr?.salesUsd ?? 0,
  };
}

function emptyResult(): InventoryMatchResult {
  return {
    primary: null,
    confidence: 0,
    reasoning: "No candidate SKUs found in inventory",
    alternates: [],
  };
}

async function aiScore(
  rfqDescription: string,
  candidates: InventoryMatchCandidate[]
): Promise<InventoryMatchResult> {
  const list = candidates
    .map(
      (c, i) =>
        `${i}: [${c.itemCode}] "${c.description}" (UM=${c.unitOfMeasure || "?"}, rank=${c.rank ?? "?"})`
    )
    .join("\n");

  const prompt = `You are matching an RFQ line to a company's internal inventory.

RFQ ITEM: "${rfqDescription}"

INTERNAL INVENTORY CANDIDATES:
${list}

Pick the candidate that most likely IS the same physical product as the RFQ item, even if wording or pack size differs slightly. If none of the candidates are a credible fit, return bestIndex=-1.

Confidence guide:
- 0.9-1.0: clearly the same product (description names the same thing)
- 0.6-0.9: same product type, minor differences in size/pack/brand
- 0.3-0.6: same product family but uncertain match
- 0.0-0.3: probably not a match; consider returning -1

Respond with ONLY valid JSON:
{ "bestIndex": <number>, "confidence": <0-1>, "reasoning": "<one short sentence>" }`;

  let evaluation: z.infer<typeof TextRankSchema>;
  try {
    const client = getAIClient();
    const response = await client.messages.create({
      model: MODELS.extraction,
      max_tokens: 256,
      messages: [{ role: "user", content: prompt }],
    });
    recordAICost("inventory_match", MODELS.extraction, response.usage);
    const text =
      response.content[0].type === "text" ? response.content[0].text : "";
    const json = text.match(/\{[\s\S]*\}/);
    if (!json) throw new Error("No JSON in response");
    evaluation = TextRankSchema.parse(JSON.parse(json[0]));
  } catch (err) {
    logger.warn(
      { err, candidates: candidates.length },
      "Inventory matcher AI call failed — falling back to text-score top candidate"
    );
    // Fallback: trust text search, low confidence so UI shows "possible match"
    return {
      primary: candidates[0],
      confidence: 0.4,
      reasoning: "Text search top result (AI evaluation unavailable)",
      alternates: candidates.slice(1, 4),
    };
  }

  if (
    evaluation.bestIndex < 0 ||
    evaluation.bestIndex >= candidates.length ||
    evaluation.confidence < 0.2
  ) {
    return {
      primary: null,
      confidence: evaluation.confidence,
      reasoning: evaluation.reasoning,
      alternates: candidates.slice(0, 3),
    };
  }

  const primary = candidates[evaluation.bestIndex];
  const alternates = candidates
    .filter((_, i) => i !== evaluation.bestIndex)
    .slice(0, 3);

  return {
    primary,
    confidence: evaluation.confidence,
    reasoning: evaluation.reasoning,
    alternates,
  };
}
