import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/connection";
import { InventoryItem } from "@/lib/db/models/InventoryItem";
import { logger } from "@/lib/logger";

/**
 * GET /api/inventory
 *
 * Browse the company's internal SKU catalog with filters.
 *
 * Query params:
 *   q       — substring match on itemCode + description (case-insensitive)
 *   active  — "true" | "false" — filter by isActive
 *   rank    — A | B | C | D | E
 *   masked  — "true" to include masked rows (default: excluded)
 *   limit   — max rows (default 100, capped at 500)
 *   skip    — pagination offset (default 0)
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const q = url.searchParams.get("q")?.trim() || "";
    const active = url.searchParams.get("active");
    const rank = url.searchParams.get("rank")?.trim() || "";
    const includeMasked = url.searchParams.get("masked") === "true";
    const limit = Math.min(
      parseInt(url.searchParams.get("limit") || "100", 10),
      500
    );
    const skip = Math.max(parseInt(url.searchParams.get("skip") || "0", 10), 0);

    await connectDB();

    const filter: Record<string, unknown> = {};
    if (!includeMasked) filter.isMasked = false;
    if (active === "true") filter.isActive = true;
    if (active === "false") filter.isActive = false;
    if (rank && ["A", "B", "C", "D", "E"].includes(rank)) filter.rank = rank;
    if (q) {
      const re = new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
      filter.$or = [{ itemCode: re }, { description: re }];
    }

    const [items, total] = await Promise.all([
      InventoryItem.find(filter)
        .sort({ "sales.pyr.salesUsd": -1, itemCode: 1 })
        .skip(skip)
        .limit(limit)
        .lean(),
      InventoryItem.countDocuments(filter),
    ]);

    return NextResponse.json({
      items: items.map((it) => ({
        id: String(it._id),
        itemCode: it.itemCode,
        description: it.description,
        unitOfMeasure: it.unitOfMeasure,
        rank: it.rank,
        primaryLocation: it.primaryLocation,
        lastSaleDate: it.lastSaleDate,
        derivedUnitCost: it.derivedUnitCost,
        isActive: it.isActive,
        isMasked: it.isMasked,
        salesPyr: it.sales?.pyr ?? null,
        salesYtd: it.sales?.ytd ?? null,
      })),
      total,
      hasMore: skip + items.length < total,
    });
  } catch (err) {
    logger.error({ err }, "Inventory list failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load inventory" },
      { status: 500 }
    );
  }
}
