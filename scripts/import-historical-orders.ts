import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import fs from "fs";
import path from "path";
import { parse } from "csv-parse/sync";
import { z } from "zod";

// DB / AI modules are dynamically imported in main() so that loadEnvConfig
// runs before they're evaluated (some modules read process.env at import).

/**
 * Import historical Amazon and Grainger order data into the Product Dictionary.
 *
 * Usage:
 *   npx tsx scripts/import-historical-orders.ts \
 *     --amazon ../amazondata.csv \
 *     --grainger "../grainger 3 year data 2026.csv" \
 *     [--dry-run] [--no-feedback] [--limit N]
 *
 * What it does:
 *   1. Parses both CSVs, dedupes by (vendor, productId).
 *   2. Maps each product to one of (stationery|deck_engine|galley_kitchen)
 *      via Amazon category + UNSPSC code heuristics.
 *   3. AI-normalizes product titles in batches of 20 (Sonnet, ~$5-10 total).
 *   4. Upserts Item documents with verified vendor mappings (source: "historical_order").
 *   5. Creates MatchFeedback records (action: "confirmed") for evaluator few-shot training.
 *   6. Idempotent — re-runs skip already-imported entries.
 *
 * Stale-price safety:
 *   - lastPrice is stored for reference but NOT used by the search engine.
 *   - Live prices are always re-fetched at search time.
 */

type Category = "stationery" | "deck_engine" | "galley_kitchen";

interface OrderRow {
  vendor: "amazon" | "grainger";
  productId: string;
  productName: string;
  brand?: string;
  partNumber?: string;
  unspsc?: string;
  amazonCategory?: string;
  lastOrderedAt: Date;
  lastPrice?: number;
}

interface NormalizedRow extends OrderRow {
  normalizedName: string;
  category: Category;
  productUrl: string;
}

const args = process.argv.slice(2);

function getArg(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const AMAZON_CSV = getArg("--amazon");
const GRAINGER_CSV = getArg("--grainger");
const DRY_RUN = args.includes("--dry-run");
const SKIP_FEEDBACK = args.includes("--no-feedback");
const LIMIT_RAW = getArg("--limit");
const LIMIT = LIMIT_RAW ? parseInt(LIMIT_RAW, 10) : null;

if (!AMAZON_CSV && !GRAINGER_CSV) {
  console.error(
    "Usage: npx tsx scripts/import-historical-orders.ts --amazon FILE --grainger FILE [--dry-run] [--no-feedback] [--limit N]"
  );
  process.exit(1);
}

function parseDate(s: string): Date {
  if (!s) return new Date(0);
  const d = new Date(s);
  return isNaN(d.getTime()) ? new Date(0) : d;
}

function num(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const n = parseFloat(s);
  return isNaN(n) ? undefined : n;
}

/**
 * Map UNSPSC code prefix → our 3 internal categories.
 * UNSPSC is hierarchical: first 2 digits = segment.
 */
function categoryFromUnspsc(code?: string): Category | null {
  if (!code) return null;
  const seg = code.substring(0, 2);
  switch (seg) {
    case "14": // Paper materials
    case "44": // Office equipment / supplies
      return "stationery";
    case "50": // Food / beverage / tobacco
    case "52": // Domestic appliances / kitchen
      return "galley_kitchen";
    case "23": // Industrial manufacturing
    case "26": // Power generation
    case "27": // Tools / hand tools
    case "31": // Manufacturing components / adhesives / rope
    case "39": // Electrical
    case "40": // Distribution / HVAC
    case "46": // Defense / safety / PPE
    case "47": // Cleaning equipment / supplies
      return "deck_engine";
    default:
      return null;
  }
}

/**
 * Map Amazon's internal category to ours. Inferred from sample data —
 * extend this list as new categories appear.
 */
function categoryFromAmazon(amazonCat?: string): Category | null {
  if (!amazonCat) return null;
  const c = amazonCat.toLowerCase();
  if (
    c.includes("office product") ||
    c.includes("office supply") ||
    c.includes("paper")
  ) {
    return "stationery";
  }
  if (
    c.includes("pantry") ||
    c.includes("kitchen") ||
    c.includes("grocery") ||
    c.includes("beverage") ||
    c.includes("food")
  ) {
    return "galley_kitchen";
  }
  if (
    c.includes("tool") ||
    c.includes("hardware") ||
    c.includes("home improvement") ||
    c.includes("industrial") ||
    c.includes("automotive") ||
    c.includes("shoes") ||
    c.includes("safety") ||
    c.includes("electrical") ||
    c.includes("ce") ||
    c.includes("scientific")
  ) {
    return "deck_engine";
  }
  return null;
}

function deriveCategory(
  unspsc?: string,
  amazonCat?: string
): Category {
  return (
    categoryFromUnspsc(unspsc) ??
    categoryFromAmazon(amazonCat) ??
    "deck_engine"
  );
}

function amazonUrl(asin: string): string {
  return `https://www.amazon.com/dp/${asin}`;
}

function graingerUrl(itemNumber: string): string {
  return `https://www.grainger.com/product/${itemNumber}`;
}

function loadAmazon(filePath: string): OrderRow[] {
  console.log(`[amazon] reading ${filePath}`);
  const csv = fs.readFileSync(filePath, "utf8");
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true,
  }) as Record<string, string>[];

  const rows: OrderRow[] = [];
  for (const r of records) {
    const asin = r["ASIN"]?.trim();
    const title = r["Title"]?.trim();
    if (!asin || !title) continue;

    rows.push({
      vendor: "amazon",
      productId: asin,
      productName: title,
      brand: r["Brand"]?.trim() || r["Manufacturer"]?.trim() || undefined,
      partNumber:
        r["Part number"]?.trim() ||
        r["Item model number"]?.trim() ||
        undefined,
      unspsc: r["UNSPSC"]?.trim() || undefined,
      amazonCategory: r["Amazon-Internal Product Category"]?.trim() || undefined,
      lastOrderedAt: parseDate(r["Order Date"]),
      lastPrice: num(r["Purchase PPU"]) ?? num(r["Listed PPU"]),
    });
  }
  console.log(`[amazon] parsed ${rows.length} order lines`);
  return rows;
}

function loadGrainger(filePath: string): OrderRow[] {
  console.log(`[grainger] reading ${filePath}`);
  const csv = fs.readFileSync(filePath, "utf8");
  const records = parse(csv, {
    columns: true,
    skip_empty_lines: true,
    relax_column_count: true,
    relax_quotes: true,
    skip_records_with_error: true,
  }) as Record<string, string>[];

  const rows: OrderRow[] = [];
  for (const r of records) {
    const itemNumber =
      r["Item Number"]?.trim() || r["Part #"]?.trim();
    const description = r["Item Description"]?.trim();
    if (!itemNumber || !description) continue;

    rows.push({
      vendor: "grainger",
      productId: itemNumber,
      productName: description,
      brand: r["Item Brand"]?.trim() || undefined,
      partNumber: r["Part #"]?.trim() || undefined,
      unspsc: r["UNSPSC"]?.trim() || undefined,
      lastOrderedAt: parseDate(r["Order Date"]),
      lastPrice: num(r["Unit Price"]),
    });
  }
  console.log(`[grainger] parsed ${rows.length} order lines`);
  return rows;
}

function dedupe(rows: OrderRow[]): OrderRow[] {
  const map = new Map<string, OrderRow>();
  for (const r of rows) {
    const key = `${r.vendor}::${r.productId}`;
    const existing = map.get(key);
    if (!existing || r.lastOrderedAt > existing.lastOrderedAt) {
      map.set(key, r);
    }
  }
  return [...map.values()];
}

const AINormalizationSchema = z.object({
  items: z.array(
    z.object({
      index: z.number(),
      normalizedName: z.string(),
    })
  ),
});

// Lazy-loaded AI client refs; set in main() after env is loaded
let getAIClient: typeof import("../src/lib/ai/client").getAIClient;
let MODELS: typeof import("../src/lib/ai/client").MODELS;
let recordAICost: typeof import("../src/lib/ai/cost-tracker").recordAICost;

async function aiNormalizeBatch(
  batch: { index: number; productName: string; brand?: string }[]
): Promise<Map<number, string>> {
  const list = batch
    .map(
      (b) =>
        `${b.index}: "${b.productName}"${b.brand ? ` [brand: ${b.brand}]` : ""}`
    )
    .join("\n");

  const prompt = `Normalize these product titles into clean, search-friendly canonical names.

PRODUCTS:
${list}

For each product, produce a normalizedName that is:
- lowercase
- 3-8 words
- captures the core product type + key spec (size/color/material/quantity)
- strips marketing fluff, model numbers, and packaging counts unless essential
- consistent across similar products (so future RFQ items match the same name)

Examples:
  "Lavazza Crema E Aroma Whole Bean Coffee Blend, 2.2-Pound Bag, ..." → "whole bean coffee 2.2lb"
  "DOWELL 18mm Snap Off Blades SK5 Utility Knife..." → "18mm snap off utility blades"
  "Pentel Rolling Writer Pen, 0.4mm Cushion Ball Tip, Violet Ink..." → "violet rolling ball pen 0.4mm"
  "FILTER ROLL 40 IN.X135 FT.X1 IN. MERV 7" → "merv 7 filter roll 40in x 135ft"

Respond with ONLY valid JSON:
{
  "items": [
    { "index": 0, "normalizedName": "..." },
    ...
  ]
}`;

  const client = getAIClient();
  const response = await client.messages.create({
    model: MODELS.reasoning,
    max_tokens: 4096,
    messages: [{ role: "user", content: prompt }],
  });

  const text =
    response.content[0].type === "text" ? response.content[0].text : "";
  recordAICost("normalization", MODELS.reasoning, response.usage);

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error("AI did not return valid JSON");
  }

  const parsed = AINormalizationSchema.parse(JSON.parse(jsonMatch[0]));
  const map = new Map<number, string>();
  for (const item of parsed.items) {
    map.set(item.index, item.normalizedName);
  }
  return map;
}

async function aiNormalize(rows: OrderRow[]): Promise<Map<number, string>> {
  const BATCH_SIZE = 20;
  const result = new Map<number, string>();
  console.log(
    `[ai] normalizing ${rows.length} unique products in ${Math.ceil(
      rows.length / BATCH_SIZE
    )} batches of ${BATCH_SIZE}...`
  );

  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE).map((r, k) => ({
      index: i + k,
      productName: r.productName,
      brand: r.brand,
    }));

    try {
      const partial = await aiNormalizeBatch(batch);
      for (const [idx, name] of partial.entries()) {
        result.set(idx, name);
      }
      process.stdout.write(
        `\r[ai] batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(
          rows.length / BATCH_SIZE
        )} done`
      );
    } catch (err) {
      console.error(
        `\n[ai] batch ${i}-${i + BATCH_SIZE} failed:`,
        err instanceof Error ? err.message : err
      );
      // Fallback: lowercase trimmed name
      for (const b of batch) {
        result.set(b.index, rows[b.index].productName.toLowerCase().trim());
      }
    }
  }
  console.log("\n[ai] normalization complete");
  return result;
}

function detectProductIdType(vendor: string): string {
  if (vendor === "amazon") return "ASIN";
  if (vendor === "grainger") return "ItemNumber";
  return "SKU";
}

async function importRows(
  rows: NormalizedRow[],
  Item: typeof import("../src/lib/db/models/Item").Item,
  MatchFeedback: typeof import("../src/lib/db/models/MatchFeedback").MatchFeedback
) {
  let newItems = 0;
  let updatedItems = 0;
  let newMappings = 0;
  let skippedAlreadyMapped = 0;
  let feedbackCreated = 0;

  for (const r of rows) {
    let item = await Item.findOne({
      normalizedName: r.normalizedName,
      category: r.category,
    });

    if (!item) {
      item = await Item.create({
        rfqDescription: r.productName,
        normalizedName: r.normalizedName,
        category: r.category,
        vendors: {},
      });
      newItems++;
    } else {
      updatedItems++;
    }

    const vendors = item.vendors as Map<string, unknown>;
    const existing = vendors.get(r.vendor) as
      | { productId?: string }
      | undefined;

    if (existing?.productId === r.productId) {
      skippedAlreadyMapped++;
    } else {
      vendors.set(r.vendor, {
        productId: r.productId,
        productIdType: detectProductIdType(r.vendor),
        searchQuery: r.normalizedName,
        productUrl: r.productUrl,
        verified: true,
        verifiedAt: r.lastOrderedAt,
      });
      await item.save();
      newMappings++;
    }

    if (!SKIP_FEEDBACK) {
      // Avoid duplicate feedback if a record for this exact (item, vendor, productId) already exists
      const existingFb = await MatchFeedback.findOne({
        itemId: item._id,
        vendorSlug: r.vendor,
        "originalMatch.productId": r.productId,
        action: "confirmed",
      });
      if (!existingFb) {
        await MatchFeedback.create({
          itemId: item._id,
          vendorSlug: r.vendor,
          originalMatch: {
            productName: r.productName,
            productId: r.productId,
            productUrl: r.productUrl,
            price: r.lastPrice,
          },
          action: "confirmed",
        });
        feedbackCreated++;
      }
    }
  }

  return {
    newItems,
    updatedItems,
    newMappings,
    skippedAlreadyMapped,
    feedbackCreated,
  };
}

async function main() {
  const allRows: OrderRow[] = [];

  if (AMAZON_CSV) {
    if (!fs.existsSync(AMAZON_CSV)) {
      console.error(`Amazon file not found: ${AMAZON_CSV}`);
      process.exit(1);
    }
    allRows.push(...loadAmazon(path.resolve(AMAZON_CSV)));
  }

  if (GRAINGER_CSV) {
    if (!fs.existsSync(GRAINGER_CSV)) {
      console.error(`Grainger file not found: ${GRAINGER_CSV}`);
      process.exit(1);
    }
    allRows.push(...loadGrainger(path.resolve(GRAINGER_CSV)));
  }

  const unique = dedupe(allRows);
  console.log(
    `\nTotal raw rows: ${allRows.length} → unique products: ${unique.length}`
  );

  const subset = LIMIT ? unique.slice(0, LIMIT) : unique;
  if (LIMIT) console.log(`(limited to first ${LIMIT} for this run)`);

  const byCategory = new Map<Category, number>();
  for (const r of subset) {
    const cat = deriveCategory(r.unspsc, r.amazonCategory);
    byCategory.set(cat, (byCategory.get(cat) || 0) + 1);
  }
  console.log(
    `Category distribution: ${[...byCategory.entries()]
      .map(([c, n]) => `${c}=${n}`)
      .join(", ")}`
  );

  // Lazy-load AI client modules now that env is set
  const aiClient = await import("../src/lib/ai/client");
  const costTracker = await import("../src/lib/ai/cost-tracker");
  getAIClient = aiClient.getAIClient;
  MODELS = aiClient.MODELS;
  recordAICost = costTracker.recordAICost;

  const normalizedNames = await aiNormalize(subset);

  const finalRows: NormalizedRow[] = subset.map((r, i) => ({
    ...r,
    normalizedName:
      normalizedNames.get(i) ?? r.productName.toLowerCase().trim(),
    category: deriveCategory(r.unspsc, r.amazonCategory),
    productUrl:
      r.vendor === "amazon"
        ? amazonUrl(r.productId)
        : graingerUrl(r.productId),
  }));

  if (DRY_RUN) {
    console.log("\n--- DRY RUN — first 10 normalized rows ---");
    for (const r of finalRows.slice(0, 10)) {
      console.log(
        `[${r.category}] ${r.vendor} ${r.productId} → "${r.normalizedName}"`
      );
    }
    console.log(`\n${finalRows.length} rows ready (not written).`);
    process.exit(0);
  }

  console.log("\n[db] connecting...");
  const { connectDB } = await import("../src/lib/db/connection");
  const { Item } = await import("../src/lib/db/models/Item");
  const { MatchFeedback } = await import(
    "../src/lib/db/models/MatchFeedback"
  );
  await connectDB();

  console.log("[db] importing...");
  const stats = await importRows(finalRows, Item, MatchFeedback);

  console.log("\n=== IMPORT COMPLETE ===");
  console.log(`New Item documents:        ${stats.newItems}`);
  console.log(`Existing Items updated:    ${stats.updatedItems}`);
  console.log(`New vendor mappings:       ${stats.newMappings}`);
  console.log(`Already mapped (skipped):  ${stats.skippedAlreadyMapped}`);
  console.log(`Feedback records created:  ${stats.feedbackCreated}`);

  const mongoose = await import("mongoose");
  await mongoose.default.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Import failed:", err);
  try {
    const mongoose = await import("mongoose");
    await mongoose.default.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
