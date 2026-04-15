import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/connection";
import { RFQ } from "@/lib/db/models/RFQ";
import { logger } from "@/lib/logger";

/**
 * GET /api/history
 *
 * Returns the most recent RFQ uploads (newest first). Each entry is a
 * lightweight summary suitable for the history list — full items / search
 * results are loaded on demand via /api/history/[id].
 */
export async function GET(request: NextRequest) {
  try {
    const url = new URL(request.url);
    const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 200);

    await connectDB();

    // Use aggregation with $size so we don't pull entire items[] arrays just
    // to count them — for RFQs with thousands of lines this is a major win.
    const rfqs = await RFQ.aggregate([
      { $sort: { uploadedAt: -1 } },
      { $limit: limit },
      {
        $project: {
          filename: 1,
          uploadedAt: 1,
          detectedCategory: 1,
          categoryConfidence: 1,
          selectedVendors: 1,
          status: 1,
          itemCount: {
            $cond: [{ $isArray: "$items" }, { $size: "$items" }, 0],
          },
        },
      },
    ]);

    const summary = rfqs.map((r) => ({
      id: String(r._id),
      filename: r.filename,
      uploadedAt: r.uploadedAt,
      detectedCategory: r.detectedCategory,
      categoryConfidence: r.categoryConfidence,
      selectedVendors: r.selectedVendors || [],
      status: r.status,
      itemCount: r.itemCount || 0,
    }));

    return NextResponse.json({ rfqs: summary });
  } catch (err) {
    logger.error({ error: err }, "History list failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Failed to load history" },
      { status: 500 }
    );
  }
}
