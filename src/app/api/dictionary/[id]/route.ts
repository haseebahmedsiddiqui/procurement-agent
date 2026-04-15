import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/connection";
import { Item } from "@/lib/db/models/Item";
import { logger } from "@/lib/logger";

/**
 * DELETE /api/dictionary/[id]
 *
 * Remove a dictionary item entirely. If `vendor` query param is provided,
 * only that one vendor mapping is removed (the item is kept for other
 * vendors). Otherwise the whole item is deleted.
 */
export async function DELETE(
  request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    const url = new URL(request.url);
    const vendor = url.searchParams.get("vendor")?.trim();

    await connectDB();

    if (vendor) {
      const item = await Item.findById(id);
      if (!item) {
        return NextResponse.json({ error: "Item not found" }, { status: 404 });
      }
      const vendors = item.vendors as Map<string, unknown>;
      vendors.delete(vendor);
      await item.save();
      return NextResponse.json({ success: true, removedVendor: vendor });
    }

    const result = await Item.findByIdAndDelete(id);
    if (!result) {
      return NextResponse.json({ error: "Item not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ error: err }, "Dictionary delete failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
