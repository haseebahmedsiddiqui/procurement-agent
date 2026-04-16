import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/connection";
import { RFQ } from "@/lib/db/models/RFQ";
import { logger } from "@/lib/logger";

/**
 * GET /api/history/[id]
 *
 * Returns the full RFQ document so the user can re-run the search against
 * a previously uploaded file without re-uploading.
 */
export async function GET(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await connectDB();

    const rfq = await RFQ.findById(id).lean();
    if (!rfq) {
      return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    }

    const searchRuns = (rfq.searchRuns || []).map((run: Record<string, unknown>) => ({
      id: String(run._id),
      searchedAt: run.searchedAt,
      vendorSlugs: run.vendorSlugs || [],
      totalResults: run.totalResults || 0,
      totalFailures: run.totalFailures || 0,
      items: run.items || [],
    }));

    return NextResponse.json({
      id: String(rfq._id),
      filename: rfq.filename,
      uploadedAt: rfq.uploadedAt,
      items: rfq.items || [],
      detectedCategory: rfq.detectedCategory,
      categoryConfidence: rfq.categoryConfidence,
      selectedVendors: rfq.selectedVendors || [],
      status: rfq.status,
      searchRuns,
    });
  } catch (err) {
    logger.error({ error: err }, "History fetch failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load RFQ" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/history/[id]
 *
 * Remove an RFQ from history.
 */
export async function DELETE(
  _request: NextRequest,
  context: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await context.params;
    await connectDB();

    const result = await RFQ.findByIdAndDelete(id);
    if (!result) {
      return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (err) {
    logger.error({ error: err }, "History delete failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Delete failed" },
      { status: 500 }
    );
  }
}
