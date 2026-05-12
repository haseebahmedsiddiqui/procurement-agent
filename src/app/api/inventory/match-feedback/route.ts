import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/connection";
import { InventoryMatchFeedback } from "@/lib/db/models/InventoryMatchFeedback";
import { InventoryItem } from "@/lib/db/models/InventoryItem";
import { logger } from "@/lib/logger";

interface FeedbackBody {
  rfqDescription: string;
  normalizedName?: string;
  impaCode?: string;
  inventoryItemId: string;
  action: "confirmed" | "rejected" | "manual";
  source?: "auto" | "manual";
  confidence?: number;
  reason?: string;
}

/**
 * POST /api/inventory/match-feedback
 *
 * Records a user's decision on an internal inventory match:
 *   - confirmed: the auto-match was correct → next time skip the AI call
 *   - rejected:  the auto-match was wrong → matcher will not suggest this SKU
 *                for this rfqDescription again
 *   - manual:    user picked this SKU themselves via the search popover
 *
 * Idempotent: same (rfqDescription, inventoryItemId, action) upserts in place.
 * Posting an opposite action (e.g. confirmed → rejected) for the same SKU
 * replaces the prior record.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as FeedbackBody;

    if (!body.rfqDescription || !body.inventoryItemId || !body.action) {
      return NextResponse.json(
        { error: "rfqDescription, inventoryItemId, and action are required" },
        { status: 400 }
      );
    }
    if (!["confirmed", "rejected", "manual"].includes(body.action)) {
      return NextResponse.json({ error: "Invalid action" }, { status: 400 });
    }

    await connectDB();

    // Pull itemCode for denormalization — saves a join on every read
    const inventoryItem = await InventoryItem.findById(body.inventoryItemId)
      .select("itemCode")
      .lean();
    if (!inventoryItem) {
      return NextResponse.json(
        { error: "Inventory item not found" },
        { status: 404 }
      );
    }

    // Drop any conflicting prior decision for the same (description, SKU)
    // pair so a user can toggle from confirmed → rejected without two rows.
    await InventoryMatchFeedback.deleteMany({
      ownerId: null,
      rfqDescription: body.rfqDescription,
      inventoryItemId: body.inventoryItemId,
    });

    const doc = await InventoryMatchFeedback.create({
      ownerId: null,
      rfqDescription: body.rfqDescription,
      normalizedName: body.normalizedName ?? null,
      impaCode: body.impaCode ?? null,
      inventoryItemId: body.inventoryItemId,
      itemCode: (inventoryItem as { itemCode: string }).itemCode,
      action: body.action,
      source: body.source ?? "auto",
      confidence: body.confidence ?? null,
      reason: body.reason ?? null,
    });

    logger.info(
      {
        rfqDescription: body.rfqDescription,
        itemCode: (inventoryItem as { itemCode: string }).itemCode,
        action: body.action,
      },
      "Inventory match feedback recorded"
    );

    return NextResponse.json({ ok: true, id: String(doc._id) });
  } catch (err) {
    logger.error({ err }, "Inventory match feedback failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/inventory/match-feedback
 *
 * Undoes a confirm/reject/manual for a specific (rfqDescription, sku).
 */
export async function DELETE(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const rfqDescription = url.searchParams.get("rfqDescription");
    const inventoryItemId = url.searchParams.get("inventoryItemId");
    if (!rfqDescription || !inventoryItemId) {
      return NextResponse.json(
        { error: "rfqDescription and inventoryItemId required" },
        { status: 400 }
      );
    }
    await connectDB();
    const r = await InventoryMatchFeedback.deleteMany({
      ownerId: null,
      rfqDescription,
      inventoryItemId,
    });
    return NextResponse.json({ ok: true, deleted: r.deletedCount });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
