import { NextRequest, NextResponse } from "next/server";
import { checkSessionHealth } from "@/lib/auth/auth-manager";

export async function POST(request: NextRequest) {
  try {
    const { vendorSlug } = await request.json();

    if (!vendorSlug) {
      return NextResponse.json(
        { error: "vendorSlug is required" },
        { status: 400 }
      );
    }

    const result = await checkSessionHealth(vendorSlug);
    return NextResponse.json(result);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Health check failed";
    console.error("Health check failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
