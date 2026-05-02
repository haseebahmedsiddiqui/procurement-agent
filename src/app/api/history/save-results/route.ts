import { NextRequest, NextResponse } from "next/server";
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
  vendorSlugs: string[];
  results: Record<string, VendorResultPayload[]>;
  summary: {
    totalResults: number;
    totalFailures: number;
  };
}

export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as SaveResultsBody;
    const { rfqId, vendorSlugs, results, summary } = body;

    if (!rfqId) {
      return NextResponse.json({ error: "rfqId is required" }, { status: 400 });
    }

    await connectDB();

    const rfq = await RFQ.findById(rfqId);
    if (!rfq) {
      return NextResponse.json({ error: "RFQ not found" }, { status: 404 });
    }

    const searchRunItems = Object.entries(results).map(([indexStr, vendorResults]) => ({
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

    const searchRun = {
      searchedAt: new Date(),
      vendorSlugs,
      totalResults: summary.totalResults,
      totalFailures: summary.totalFailures,
      items: searchRunItems,
    };

    rfq.searchRuns = rfq.searchRuns || [];
    rfq.searchRuns.push(searchRun);
    rfq.status = "completed";
    rfq.selectedVendors = vendorSlugs;
    await rfq.save();

    logger.info(
      { rfqId, runIndex: rfq.searchRuns.length - 1, totalResults: summary.totalResults },
      "Search results saved to history"
    );

    return NextResponse.json({
      success: true,
      runIndex: rfq.searchRuns.length - 1,
    });
  } catch (err) {
    logger.error({ error: err }, "Save search results failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Save failed" },
      { status: 500 }
    );
  }
}
