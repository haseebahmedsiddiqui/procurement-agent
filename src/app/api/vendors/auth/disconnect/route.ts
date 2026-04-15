import { NextRequest, NextResponse } from "next/server";
import { disconnect } from "@/lib/auth/auth-manager";

export async function POST(request: NextRequest) {
  try {
    const { vendorSlug } = await request.json();

    if (!vendorSlug) {
      return NextResponse.json(
        { error: "vendorSlug is required" },
        { status: 400 }
      );
    }

    await disconnect(vendorSlug);

    return NextResponse.json({ success: true, vendorSlug });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Disconnect failed";
    console.error("Disconnect failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
