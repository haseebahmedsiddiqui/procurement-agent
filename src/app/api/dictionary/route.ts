import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/connection";
import { Item } from "@/lib/db/models/Item";
import { logger } from "@/lib/logger";

/**
 * GET /api/dictionary
 *
 * Returns Items in the Product Dictionary, optionally filtered.
 *
 * Query params:
 *   q        — text search across normalizedName / rfqDescription / impaCode
 *   category — stationery | deck_engine | galley_kitchen
 *   vendor   — only include items that have a verified mapping for this vendor
 *   limit    — max rows per page (default 100, capped at 1000)
 *   skip     — pagination offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() || "";
    const category = url.searchParams.get("category")?.trim() || "";
    const vendor = url.searchParams.get("vendor")?.trim() || "";
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "100", 10),
      1000
    );
    const skip = Math.max(parseInt(url.searchParams.get("skip") || "0", 10), 0);

    await connectDB();

    const filter: Record<string, unknown> = {};
    if (category) filter.category = category;
    if (vendor) filter[`vendors.${vendor}`] = { $exists: true };
    if (q) {
      // Case-insensitive substring across the searchable text fields
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [
        { normalizedName: re },
        { rfqDescription: re },
        { impaCode: re },
      ];
    }

    const [items, total] = await Promise.all([
      Item.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
      Item.countDocuments(filter),
    ]);

    const summary = items.map((it) => {
      // Mongoose .lean() returns vendors as a plain object, not a Map
      const vendors = (it.vendors || {}) as Record<string, Record<string, unknown>>;
      const vendorEntries = Object.entries(vendors).map(([slug, data]) => ({
        slug,
        productId: data.productId as string,
        productUrl: data.productUrl as string,
        verified: data.verified as boolean,
      }));
      return {
        id: String(it._id),
        rfqDescription: it.rfqDescription,
        normalizedName: it.normalizedName,
        impaCode: it.impaCode,
        category: it.category,
        vendors: vendorEntries,
        updatedAt: it.updatedAt,
      };
    });

    return NextResponse.json({
      items: summary,
      total,
      page: Math.floor(skip / limit) + 1,
      pageSize: limit,
      hasMore: skip + summary.length < total,
    });
  } catch (err) {
    logger.error({ error: err }, "Dictionary list failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load dictionary" },
      { status: 500 }
    );
  }
}
