import { z } from "zod";
import { getAIClient, MODELS } from "./client";
import { recordAICost } from "./cost-tracker";
import { connectDB } from "@/lib/db/connection";
import { Vendor } from "@/lib/db/models/Vendor";
import type { ParsedRFQItem } from "@/lib/parsers/rfq-parser";
import { logger } from "@/lib/logger";

const NormalizedItemSchema = z.object({
  index: z.number(),
  normalizedName: z.string(),
  searchQueries: z.record(z.string(), z.string()), // vendorSlug -> optimized query
});

const NormalizationResultSchema = z.object({
  items: z.array(NormalizedItemSchema),
});

export type NormalizedItem = z.infer<typeof NormalizedItemSchema>;

/**
 * Normalize RFQ item descriptions and generate vendor-specific search queries.
 *
 * Each vendor gets a tailored query:
 * - Amazon: consumer-friendly terms
 * - McMaster: technical/industrial terms with dimensions
 * - Staples: standard office supply terms
 * etc.
 *
 * Processes items in batches of 5 to optimize API costs.
 */
export async function normalizeItems(
  items: ParsedRFQItem[],
  vendorSlugs: string[]
): Promise<NormalizedItem[]> {
  await connectDB();

  // Fetch vendor configs for search query templates
  const vendors = await Vendor.find({ slug: { $in: vendorSlugs } }).lean();
  const vendorContext = vendors
    .map(
      (v) =>
        `- ${v.slug} ("${v.name}"): ${v.searchQueryTemplate || "Use standard terms."}`
    )
    .join("\n");

  // Process in batches of 5
  const BATCH_SIZE = 5;
  const allResults: NormalizedItem[] = [];

  for (let i = 0; i < items.length; i += BATCH_SIZE) {
    const batch = items.slice(i, i + BATCH_SIZE);
    const batchResults = await normalizeBatch(batch, i, vendorSlugs, vendorContext);
    allResults.push(...batchResults);
  }

  logger.info(
    { totalItems: items.length, vendors: vendorSlugs.length },
    "Item normalization complete"
  );

  return allResults;
}

async function normalizeBatch(
  batch: ParsedRFQItem[],
  startIndex: number,
  vendorSlugs: string[],
  vendorContext: string
): Promise<NormalizedItem[]> {
  const itemList = batch
    .map(
      (item, idx) =>
        `${startIndex + idx}: "${item.description}"${item.impaCode ? ` [IMPA: ${item.impaCode}]` : ""}${item.notes ? ` (${item.notes})` : ""} — qty: ${item.quantity} ${item.unit}`
    )
    .join("\n");

  const prompt = `You are a procurement search query optimizer. Normalize these RFQ item descriptions and generate vendor-specific search queries.

VENDOR SEARCH STRATEGIES:
${vendorContext}

ITEMS:
${itemList}

For each item, provide:
1. normalizedName: A clean, standardized product name (English, lowercase, no abbreviations)
2. searchQueries: An optimized search query for EACH vendor slug: ${vendorSlugs.join(", ")}

Respond with ONLY valid JSON:
{
  "items": [
    {
      "index": 0,
      "normalizedName": "medium binder clips 32mm",
      "searchQueries": {
        "${vendorSlugs[0]}": "optimized query for this vendor",
        ${vendorSlugs.slice(1).map((s) => `"${s}": "optimized query for ${s}"`).join(",\n        ")}
      }
    }
  ]
}

Rules:
- normalizedName should be a clean, search-friendly product name
- Each vendor's query should be tailored to that vendor's catalog style
- For Amazon: use consumer-friendly terms, include "pack" or "box" for bulk items
- For McMaster/Grainger: use technical/industrial terms, include dimensions
- For Staples/OfficeDepot: use standard office supply terms
- For Webstaurant/Equippers: use commercial kitchen/foodservice terms
- Keep queries concise (3-6 words typically)`;

  const client = getAIClient();

  const response = await client.messages.create({
    model: MODELS.reasoning,
    max_tokens: 2048,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.info(
    { usage: response.usage, batchSize: batch.length },
    "Normalization batch API call"
  );
  recordAICost("normalization", MODELS.reasoning, response.usage);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI did not return valid JSON for normalization");
  }

  const parsed = JSON.parse(jsonMatch[0]);
  const result = NormalizationResultSchema.parse(parsed);

  return result.items;
}
