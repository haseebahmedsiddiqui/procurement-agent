import { z } from "zod";
import { getAIClient, MODELS } from "./client";
import { recordAICost } from "./cost-tracker";
import { logger } from "@/lib/logger";

const ExtractedProductSchema = z.object({
  productName: z.string(),
  productId: z.string(),
  productUrl: z.string(),
  price: z.number(),
  currency: z.string().default("USD"),
  pricePerUnit: z.number().optional(),
  inStock: z.boolean(),
  deliveryEstimate: z.string().optional(),
  imageUrl: z.string().optional(),
});

const ExtractionResultSchema = z.object({
  products: z.array(ExtractedProductSchema),
  noResults: z.boolean().default(false),
});

export type ExtractedProduct = z.infer<typeof ExtractedProductSchema>;

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

  // 40k chars ≈ 10k tokens — well within Haiku's window and ~3x our prior budget.
  // Adapters that pre-extract product cards (Amazon) usually fit comfortably under this.
  const MAX_HTML_CHARS = 40000;
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
    const result = ExtractionResultSchema.parse(parsed);

    if (result.noResults) {
      logger.info({ vendor: vendorSlug, query: searchQuery }, "No results found");
      return [];
    }

    return result.products;
  } catch (err) {
    logger.warn({ vendor: vendorSlug, error: err }, "Failed to parse extraction response");
    return [];
  }
}
