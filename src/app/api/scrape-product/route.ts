import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { browserPool } from "@/lib/auth/browser-pool";
import { loadSession } from "@/lib/auth/session-store";
import { getAIClient, MODELS } from "@/lib/ai/client";
import { recordAICost } from "@/lib/ai/cost-tracker";
import { logger } from "@/lib/logger";

const RequestSchema = z.object({
  url: z.string().url(),
  rfqDescription: z.string().optional(),
});

const VENDOR_DOMAIN_MAP: Record<string, string> = {
  "amazon.com": "amazon",
  "www.amazon.com": "amazon",
  "mcmaster.com": "mcmaster",
  "www.mcmaster.com": "mcmaster",
  "grainger.com": "grainger",
  "www.grainger.com": "grainger",
  "staples.com": "staples",
  "www.staples.com": "staples",
  "officedepot.com": "officedepot",
  "www.officedepot.com": "officedepot",
  "officebasics.com": "officebasics",
  "www.officebasics.com": "officebasics",
  "webstaurantstore.com": "webstaurant",
  "www.webstaurantstore.com": "webstaurant",
  "quippers.com": "equippers",
  "www.quippers.com": "equippers",
};

function detectVendorFromUrl(url: string): string | null {
  try {
    const hostname = new URL(url).hostname;
    return VENDOR_DOMAIN_MAP[hostname] ?? null;
  } catch {
    return null;
  }
}

function needsPlaywright(vendor: string | null): boolean {
  return vendor === "amazon" || vendor === "mcmaster" || vendor === "officebasics";
}

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

async function fetchPageHtml(url: string, vendor: string | null): Promise<string | null> {
  if (needsPlaywright(vendor)) {
    const sessionSlug = vendor === "amazon" ? "amazon" : vendor;
    const session = sessionSlug ? await loadSession(sessionSlug) : null;
    const page = await browserPool.getPage(sessionSlug || "generic", session?.cookies);
    try {
      await page.goto(url, { waitUntil: "domcontentloaded", timeout: 25000 });
      await page.waitForTimeout(1500 + Math.random() * 500);
      await page.evaluate(() => window.scrollBy(0, 400));
      await page.waitForTimeout(500);
      const html = await page.content();
      await page.close();
      await browserPool.closeContext(sessionSlug || "generic");
      return html;
    } catch (err) {
      try { await page.close(); } catch { /* ignore */ }
      await browserPool.closeContext(sessionSlug || "generic");
      throw err;
    }
  }

  const res = await fetch(url, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36",
      Accept: "text/html,application/xhtml+xml",
    },
    signal: AbortSignal.timeout(15000),
  });

  if (!res.ok) return null;
  return res.text();
}

async function extractProductFromHtml(
  html: string,
  url: string,
  vendor: string | null
): Promise<Record<string, unknown> | null> {
  const cleaned = cleanHtml(html);
  const MAX_CHARS = 30000;
  const truncated =
    cleaned.length > MAX_CHARS
      ? cleaned.slice(0, MAX_CHARS) + "\n... [truncated]"
      : cleaned;

  const prompt = `Extract product details from this single product page.

URL: ${url}
${vendor ? `VENDOR: ${vendor}` : ""}

HTML:
${truncated}

Extract:
- productName: the full product name/title
- productId: the vendor's product ID (ASIN for Amazon, SKU for others)
- productUrl: "${url}"
- price: the current price as a number (not "was" price)
- currency: "USD" (or other if shown)
- inStock: true/false
- imageUrl: product image URL if visible

Respond with ONLY valid JSON:
{
  "productName": "...",
  "productId": "...",
  "productUrl": "${url}",
  "price": 0.00,
  "currency": "USD",
  "inStock": true,
  "imageUrl": "..."
}

If the page is an error, CAPTCHA, or not a product page, return:
{"error": "description of issue"}`;

  const client = getAIClient();
  const response = await client.messages.create({
    model: MODELS.extraction,
    max_tokens: 800,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";

  logger.info(
    { usage: response.usage, vendor, model: MODELS.extraction },
    "Single-product extraction API call"
  );
  recordAICost("product_scrape", MODELS.extraction, response.usage);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const parsed = JSON.parse(jsonMatch[0]);
    if (parsed.error) {
      logger.warn({ vendor, url, error: parsed.error }, "Product page extraction error");
      return null;
    }
    if (!parsed.productName || typeof parsed.price !== "number") return null;
    return {
      productName: parsed.productName,
      productId: parsed.productId ?? "",
      productUrl: url,
      price: parsed.price,
      currency: parsed.currency ?? "USD",
      inStock: parsed.inStock ?? true,
      imageUrl: parsed.imageUrl ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * POST /api/scrape-product
 *
 * Scrape a single product page to extract name, price, and other details.
 * Used when an operator pastes an alternate product URL during rejection
 * or when manually filling a no-result cell.
 *
 * Body: { url: string, rfqDescription?: string }
 * Response: { productName, productId, productUrl, price, currency, inStock, imageUrl }
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { url } = RequestSchema.parse(body);

    const vendor = detectVendorFromUrl(url);
    logger.info({ url, vendor }, "Scraping single product page");

    const html = await fetchPageHtml(url, vendor);
    if (!html) {
      return NextResponse.json(
        { error: "Failed to fetch product page" },
        { status: 502 }
      );
    }

    const product = await extractProductFromHtml(html, url, vendor);
    if (!product) {
      return NextResponse.json(
        { error: "Could not extract product details from page" },
        { status: 422 }
      );
    }

    return NextResponse.json(product);
  } catch (err) {
    logger.error({ err }, "Product scrape failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Scrape failed" },
      { status: 500 }
    );
  }
}
