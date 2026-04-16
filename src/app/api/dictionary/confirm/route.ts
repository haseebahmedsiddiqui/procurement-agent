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
}

/**
 * POST /api/dictionary/confirm
 *
 * Persist user feedback into the Product Dictionary so future lookups can
 * short-circuit the AI extraction layer AND so the match-evaluator can use
 * past decisions as few-shot examples.
 *
 * Body: { matches?: ConfirmedMatch[], rejections?: RejectedMatch[] }
 *
 * Confirmed matches upsert an Item by (normalizedName + category) and merge
 * the vendor mapping in. Both confirmed and rejected actions write a
 * MatchFeedback record (the rejected ones don't touch Item.vendors but they
 * still feed the few-shot pool so the LLM learns what NOT to pick).
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as {
      matches?: ConfirmedMatch[];
      rejections?: RejectedMatch[];
    };
    const matches = body.matches || [];
    const rejections = body.rejections || [];

    if (matches.length === 0 && rejections.length === 0) {
      return NextResponse.json(
        { error: "matches or rejections array is required" },
        { status: 400 }
      );
    }

    await connectDB();

    let savedItems = 0;
    let savedMappings = 0;
    let savedRejections = 0;

    for (const m of matches) {
      // Find or create item
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

      // Merge vendor mapping
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

      // Record feedback for future few-shot prompting
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
      // Find or create item — rejections still need an Item to attach to
      // so the few-shot loader can join by category later.
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
      });
      savedRejections++;
    }

    logger.info(
      {
        savedItems,
        savedMappings,
        savedRejections,
        confirmed: matches.length,
        rejected: rejections.length,
      },
      "Dictionary feedback batch saved"
    );

    return NextResponse.json({
      success: true,
      savedItems,
      savedMappings,
      savedRejections,
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
