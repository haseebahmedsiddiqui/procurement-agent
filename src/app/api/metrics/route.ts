import { NextResponse } from "next/server";
import { getAllVendorMetrics } from "@/lib/vendors/metrics";
import { getCostSummary } from "@/lib/ai/cost-tracker";

/**
 * GET /api/metrics
 *
 * Returns per-vendor search metrics and AI cost summary for the
 * current server process lifetime. Useful for the Settings dashboard
 * and operational monitoring.
 */
export async function GET() {
  const vendors = getAllVendorMetrics();
  const aiCosts = getCostSummary();
  return NextResponse.json({ vendors, aiCosts });
}
