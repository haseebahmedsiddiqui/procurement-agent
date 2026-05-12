import { NextRequest, NextResponse } from "next/server";
import mongoose from "mongoose";
import { connectDB } from "@/lib/db/connection";
import { RFQ } from "@/lib/db/models/RFQ";
import { logger } from "@/lib/logger";

interface VendorResultPayload {
  vendorSlug: string;
  productName?: string;
  productId?: string;
  productUrl?: string;
  price?: number;
  currency?: string;
  inStock?: boolean;
  reviewCount?: number;
  starRating?: number;
  source?: string;
  error?: string;
}

interface SaveResultsBody {
  rfqId: string;
  /**
   * If present, update the existing searchRun with this id (stream-save mode).
   * If absent, append a new searchRun.
   */
  runId?: string;
  vendorSlugs: string[];
  results: Record<string, VendorResultPayload[]>;
  summary: {
    totalResults: number;
    totalFailures: number;
  };
  /**
   * Run status after this save:
   *   "running"   — client is still streaming results
   *   "completed" — search ended cleanly
   *   "cancelled" — user aborted; partial data preserved
   */
  status?: "running" | "completed" | "cancelled" | "failed";
}

function buildSearchRunItems(results: SaveResultsBody["results"]) {
  return Object.entries(results).map(([indexStr, vendorResults]) => ({
    itemIndex: parseInt(indexStr, 10),
    results: vendorResults.map((r) => ({
      vendorSlug: r.vendorSlug,
      productName: r.productName,
      productId: r.productId,
      productUrl: r.productUrl,
      price: r.price,
      currency: r.currency,
      inStock: r.inStock,
      reviewCount: r.reviewCount,
      starRating: r.starRating,
      source: r.source,
      error: r.error,
    })),
  }));
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SaveResultsBody;
    const { rfqId, runId, vendorSlugs, results, summary, status } = body;

    if (!rfqId) {
      return NextResponse.json({ error: "rfqId is required" }, { status: 400 });
    }

    await connectDB();

    const rfq = await RFQ.findById(rfqId);
    if (!rfq) {
      return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    }

    rfq.searchRuns = rfq.searchRuns || [];
    const items = buildSearchRunItems(results);
    const finalStatus = status ?? "completed";
    const now = new Date();

    let targetRunIndex: number;

    if (runId) {
      // Update an existing run in place
      targetRunIndex = rfq.searchRuns.findIndex(
        (r: { _id?: mongoose.Types.ObjectId }) => String(r._id) === runId
      );
      if (targetRunIndex < 0) {
        return NextResponse.json({ error: "Run not found" }, { status: 404 });
      }
      const run = rfq.searchRuns[targetRunIndex];
      run.items = items;
      run.vendorSlugs = vendorSlugs;
      run.totalResults = summary.totalResults;
      run.totalFailures = summary.totalFailures;
      run.status = finalStatus;
      if (finalStatus !== "running") run.completedAt = now;
    } else {
      // Create a new run
      const newRun = {
        searchedAt: now,
        completedAt: finalStatus === "running" ? null : now,
        status: finalStatus,
        vendorSlugs,
        totalResults: summary.totalResults,
        totalFailures: summary.totalFailures,
        items,
      };
      rfq.searchRuns.push(newRun);
      targetRunIndex = rfq.searchRuns.length - 1;
    }

    // Only mark RFQ as completed when the run is truly done. Otherwise the
    // history list would show "completed" for a run that's still streaming.
    if (finalStatus === "completed") {
      rfq.status = "completed";
    } else if (finalStatus === "running") {
      rfq.status = "processing";
    }
    rfq.selectedVendors = vendorSlugs;
    await rfq.save();

    const savedRun = rfq.searchRuns[targetRunIndex];

    logger.info(
      {
        rfqId,
        runId: String(savedRun._id),
        status: finalStatus,
        totalResults: summary.totalResults,
      },
      "Search results saved to history"
    );

    return NextResponse.json({
      success: true,
      runIndex: targetRunIndex,
      runId: String(savedRun._id),
      status: finalStatus,
    });
  } catch (err) {
    logger.error({ error: err }, "Save search results failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }
}
