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

interface InternalMatchPayload {
  primary?: {
    id?: string;
    itemCode?: string;
    description?: string;
    unitOfMeasure?: string;
    rank?: "A" | "B" | "C" | "D" | "E" | null;
    derivedUnitCost?: number | null;
    isActive?: boolean;
    pyrUnits?: number;
    pyrSalesUsd?: number;
  } | null;
  confidence?: number;
  reasoning?: string;
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
  /** Per-item internal inventory matches, keyed by itemIndex (as string). */
  internalMatches?: Record<string, InternalMatchPayload>;
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

function buildSearchRunItems(
  results: SaveResultsBody["results"],
  internalMatches?: SaveResultsBody["internalMatches"]
) {
  // Union of itemIndexes across both inputs so an item with only an internal
  // match (no vendor results yet) is still persisted.
  const indexSet = new Set<string>([
    ...Object.keys(results),
    ...(internalMatches ? Object.keys(internalMatches) : []),
  ]);

  return Array.from(indexSet).map((indexStr) => {
    const vendorResults = results[indexStr] ?? [];
    const m = internalMatches?.[indexStr];
    return {
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
      internalMatch:
        m && m.primary
          ? {
              inventoryItemId: m.primary.id,
              itemCode: m.primary.itemCode,
              description: m.primary.description,
              unitOfMeasure: m.primary.unitOfMeasure,
              rank: m.primary.rank ?? null,
              derivedUnitCost: m.primary.derivedUnitCost ?? null,
              isActive: m.primary.isActive ?? false,
              pyrUnits: m.primary.pyrUnits ?? 0,
              pyrSalesUsd: m.primary.pyrSalesUsd ?? 0,
              confidence: m.confidence ?? 0,
              reasoning: m.reasoning ?? "",
            }
          : null,
    };
  });
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SaveResultsBody;
    const { rfqId, runId, vendorSlugs, results, internalMatches, summary, status } = body;

    if (!rfqId) {
      return NextResponse.json({ error: "rfqId is required" }, { status: 400 });
    }

    await connectDB();

    const rfq = await RFQ.findById(rfqId);
    if (!rfq) {
      return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    }

    rfq.searchRuns = rfq.searchRuns || [];
    const items = buildSearchRunItems(results, internalMatches);
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
