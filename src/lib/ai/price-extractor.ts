import { z } from "zod";
import { getAIClient, MODELS } from "./client";
import { recordAICost } from "./cost-tracker";
import { logger } from "@/lib/logger";

// Lenient schema for raw LLM output — Amazon often returns null for price on
// sponsored cards / out-of-stock items / "coming soon" placeholders. We accept
// null here, then filter to complete products before returning.
const RawExtractedProductSchema = z.object({
  productName: z.string().nullable().optional(),
  productId: z.string().nullable().optional(),
  productUrl: z.string().nullable().optional(),
  price: z.number().nullable().optional(),
  currency: z.string().nullable().optional(),
  pricePerUnit: z.number().nullable().optional(),
  inStock: z.boolean().nullable().optional(),
  deliveryEstimate: z.string().nullable().optional(),
  imageUrl: z.string().nullable().optional(),
});

const RawExtractionResultSchema = z.object({
  products: z.array(RawExtractedProductSchema).default([]),
  noResults: z.boolean().default(false),
});

export interface ExtractedProduct {
  productName: string;
  productId: string;
  productUrl: string;
  price: number;
  currency: string;
  pricePerUnit?: number;
  inStock: boolean;
  deliveryEstimate?: string;
  imageUrl?: string;
}

/**
 * Strip noise tags that bloat HTML without adding extractable signal.
 * Run before truncation so the LLM sees dense product data.
 */
function cleanHtml(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript>/gi, "")
    .replace(/<svg\b[^>]*>[\s\S]*?<\/svg>/gi, "")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Use AI to extract product data from vendor search result HTML.
 * Uses Haiku for cost efficiency — extraction is straightforward.
 */
export async function extractPricesFromHtml(
  html: string,
  searchQuery: string,
  vendorSlug: string,
  extractionHints: string
): Promise<ExtractedProduct[]> {
  // Strip noise (script/style/svg/comments) BEFORE truncating
  const cleaned = cleanHtml(html);

  // 20k chars ≈ 5k tokens. Lower budget reduces 50K-tokens/min rate-limit hits
  // when several vendor extractions run in parallel.
  const MAX_HTML_CHARS = 30000;
  const truncatedHtml =
    cleaned.length > MAX_HTML_CHARS
      ? cleaned.slice(0, MAX_HTML_CHARS) + "\n... [truncated]"
      : cleaned;

  const prompt = `Extract product search results from this ${vendorSlug} HTML page.

SEARCH QUERY: "${searchQuery}"

VENDOR HINTS: ${extractionHints}

HTML CONTENT:
${truncatedHtml}

Extract the TOP 3 most relevant products. For each product, provide:
- productName: the full product name
- productId: the vendor's product ID (ASIN for Amazon, SKU for Staples, etc.)
- productUrl: full URL to the product page
- price: the price as a number (the main/current price, not "was" price)
- currency: "USD" (or other if shown)
- pricePerUnit: calculated per-unit price if the item is a pack/box
- inStock: true/false
- deliveryEstimate: shipping estimate if visible
- imageUrl: product image URL if visible

Respond with ONLY valid JSON:
{
  "products": [...],
  "noResults": false
}

If no products were found or the page shows an error/captcha, return:
{"products": [], "noResults": true}`;

  const client = getAIClient();

  const response = await client.messages.create({
    model: MODELS.extraction,
    max_tokens: 1500,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.info(
    { usage: response.usage, vendor: vendorSlug, model: MODELS.extraction },
    "Price extraction API call"
  );
  recordAICost("price_extraction", MODELS.extraction, response.usage);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    logger.warn({ vendor: vendorSlug }, "No JSON in extraction response");
    return [];
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    const result = RawExtractionResultSchema.parse(parsed);

    if (result.noResults) {
      logger.info({ vendor: vendorSlug, query: searchQuery }, "No results found");
      return [];
    }

    // Keep only products that have the bare minimum (name + price + URL).
    // A sponsored card without a price is useless to procurement; dropping it
    // is better than failing the whole extraction.
    const valid: ExtractedProduct[] = [];
    let dropped = 0;
    for (const p of result.products) {
      if (
        p.productName &&
        typeof p.price === "number" &&
        p.productUrl
      ) {
        valid.push({
          productName: p.productName,
          productId: p.productId ?? "",
          productUrl: p.productUrl,
          price: p.price,
          currency: p.currency ?? "USD",
          pricePerUnit: p.pricePerUnit ?? undefined,
          inStock: p.inStock ?? true,
          deliveryEstimate: p.deliveryEstimate ?? undefined,
          imageUrl: p.imageUrl ?? undefined,
        });
      } else {
        dropped++;
      }
    }

    if (dropped > 0) {
      logger.info(
        { vendor: vendorSlug, kept: valid.length, dropped },
        "Filtered incomplete products from extraction"
      );
    }

    return valid;
  } catch (err) {
    logger.warn(
      {
        vendor: vendorSlug,
        message: err instanceof Error ? err.message : String(err),
      },
      "Failed to parse extraction response"
    );
    return [];
  }
}
