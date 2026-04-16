import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/connection";
import { Item } from "@/lib/db/models/Item";
import { MatchFeedback } from "@/lib/db/models/MatchFeedback";
import { logger } from "@/lib/logger";

interface ConfirmedMatch {
  rfqDescription: string;
  normalizedName: string;
  impaCode?: string;
  category: string;
  vendorSlug: string;
  productName: string;
  productId: string;
  productUrl: string;
  price?: number;
  confidence?: number;
}

interface RejectedMatch {
  rfqDescription: string;
  normalizedName: string;
  impaCode?: string;
  category: string;
  vendorSlug: string;
  productName: string;
  productId?: string;
  productUrl?: string;
  price?: number;
  confidence?: number;
  reason?: string;
  suggestedProductUrl?: string;
}

interface ManualEntry {
  rfqDescription: string;
  normalizedName: string;
  impaCode?: string;
  category: string;
  vendorSlug: string;
  productName: string;
  productId?: string;
  productUrl: string;
  price?: number;
  searchSuggestion?: string;
}

/**
 * POST /api/dictionary/confirm
 *
 * Persist user feedback into the Product Dictionary so future lookups can
 * short-circuit the AI extraction layer AND so the match-evaluator can use
 * past decisions as few-shot examples.
 *
 * Body: { matches?, rejections?, manualEntries? }
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      matches?: ConfirmedMatch[];
      rejections?: RejectedMatch[];
      manualEntries?: ManualEntry[];
    };
    const matches = body.matches || [];
    const rejections = body.rejections || [];
    const manualEntries = body.manualEntries || [];

    if (matches.length === 0 && rejections.length === 0 && manualEntries.length === 0) {
      return NextResponse.json(
        { error: "matches, rejections, or manualEntries array is required" },
        { status: 400 }
      );
    }

    await connectDB();

    let savedItems = 0;
    let savedMappings = 0;
    let savedRejections = 0;
    let savedManualEntries = 0;

    for (const m of matches) {
      let item = await Item.findOne({
        normalizedName: m.normalizedName,
        category: m.category,
      });

      if (!item) {
        item = await Item.create({
          rfqDescription: m.rfqDescription,
          normalizedName: m.normalizedName,
          impaCode: m.impaCode,
          category: m.category,
          vendors: {},
        });
        savedItems++;
      }

      const vendors = item.vendors as Map<string, unknown>;
      vendors.set(m.vendorSlug, {
        productId: m.productId,
        productIdType: detectProductIdType(m.vendorSlug),
        searchQuery: m.normalizedName,
        productUrl: m.productUrl,
        verified: true,
        verifiedAt: new Date(),
      });
      await item.save();
      savedMappings++;

      await MatchFeedback.create({
        itemId: item._id,
        vendorSlug: m.vendorSlug,
        originalMatch: {
          productName: m.productName,
          productId: m.productId,
          productUrl: m.productUrl,
          price: m.price,
          confidence: m.confidence,
        },
        action: "confirmed",
      });
    }

    for (const r of rejections) {
      let item = await Item.findOne({
        normalizedName: r.normalizedName,
        category: r.category,
      });

      if (!item) {
        item = await Item.create({
          rfqDescription: r.rfqDescription,
          normalizedName: r.normalizedName,
          impaCode: r.impaCode,
          category: r.category,
          vendors: {},
        });
        savedItems++;
      }

      // If operator suggested an alternate URL, store it as a corrected mapping
      if (r.suggestedProductUrl?.trim()) {
        const vendors = item.vendors as Map<string, unknown>;
        vendors.set(r.vendorSlug, {
          productId: r.productId || "",
          productIdType: detectProductIdType(r.vendorSlug),
          searchQuery: r.normalizedName,
          productUrl: r.suggestedProductUrl.trim(),
          verified: false,
          source: "operator_suggestion",
          verifiedAt: new Date(),
        });
        await item.save();
      }

      await MatchFeedback.create({
        itemId: item._id,
        vendorSlug: r.vendorSlug,
        originalMatch: {
          productName: r.productName,
          productId: r.productId,
          productUrl: r.productUrl,
          price: r.price,
          confidence: r.confidence,
        },
        action: "rejected",
        reason: r.reason?.trim() || undefined,
        suggestedProductUrl: r.suggestedProductUrl?.trim() || undefined,
      });
      savedRejections++;
    }

    for (const e of manualEntries) {
      let item = await Item.findOne({
        normalizedName: e.normalizedName,
        category: e.category,
      });

      if (!item) {
        item = await Item.create({
          rfqDescription: e.rfqDescription,
          normalizedName: e.normalizedName,
          impaCode: e.impaCode,
          category: e.category,
          vendors: {},
        });
        savedItems++;
      }

      const vendors = item.vendors as Map<string, unknown>;
      vendors.set(e.vendorSlug, {
        productId: e.productId || "",
        productIdType: detectProductIdType(e.vendorSlug),
        searchQuery: e.normalizedName,
        productUrl: e.productUrl,
        verified: true,
        verifiedAt: new Date(),
        source: "manual_entry",
      });
      await item.save();
      savedMappings++;

      await MatchFeedback.create({
        itemId: item._id,
        vendorSlug: e.vendorSlug,
        originalMatch: {
          productName: e.productName,
          productId: e.productId,
          productUrl: e.productUrl,
          price: e.price,
        },
        action: "manual_entry",
        searchSuggestion: e.searchSuggestion?.trim() || undefined,
      });
      savedManualEntries++;
    }

    logger.info(
      {
        savedItems,
        savedMappings,
        savedRejections,
        savedManualEntries,
        confirmed: matches.length,
        rejected: rejections.length,
        manual: manualEntries.length,
      },
      "Dictionary feedback batch saved"
    );

    return NextResponse.json({
      success: true,
      savedItems,
      savedMappings,
      savedRejections,
      savedManualEntries,
    });
  } catch (err) {
    logger.error({ error: err }, "Dictionary confirm failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }
}

function detectProductIdType(vendorSlug: string): string {
  if (vendorSlug.startsWith("amazon")) return "ASIN";
  if (vendorSlug === "mcmaster") return "PartNumber";
  if (vendorSlug === "grainger") return "ItemNumber";
  return "SKU";
}
