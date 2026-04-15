import { NextRequest, NextResponse } from "next/server";
import {
  getAllBreakerStatuses,
  resetBreaker,
} from "@/lib/vendors/circuit-breaker";

/**
 * GET /api/vendors/health
 *
 * Returns circuit breaker status for every vendor that has been used
 * in this server process lifetime. Statuses include state (closed/open/
 * half_open), failure count, and timestamps.
 */
export async function GET() {
  const statuses = getAllBreakerStatuses();
  return NextResponse.json({ breakers: statuses });
}

/**
 * POST /api/vendors/health
 *
 * Reset a vendor's circuit breaker back to closed. Used by the operator
 * when a vendor issue has been resolved and they want to re-enable it.
 */
export async function POST(request: NextRequest) {
  try {
    const { vendorSlug } = await request.json();
    if (!vendorSlug || typeof vendorSlug !== "string") {
      return NextResponse.json(
        { error: "vendorSlug is required" },
        { status: 400 }
      );
    }
    resetBreaker(vendorSlug);
    return NextResponse.json({ success: true, vendorSlug });
  } catch {
    return NextResponse.json(
      { error: "Invalid request" },
      { status: 400 }
    );
  }
}
