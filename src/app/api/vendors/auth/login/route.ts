import { NextRequest, NextResponse } from "next/server";
import { ensureLoggedIn } from "@/lib/auth/auth-manager";
import { browserPool } from "@/lib/auth/browser-pool";

export async function POST(request: NextRequest) {
  try {
    const { vendorSlug } = await request.json();

    if (!vendorSlug) {
      return NextResponse.json(
        { error: "vendorSlug is required" },
        { status: 400 }
      );
    }

    // This opens a browser for manual login and waits
    const page = await ensureLoggedIn(vendorSlug);

    // Close the page after login is done (session is already saved)
    await page.close();
    await browserPool.closeContext(vendorSlug);

    return NextResponse.json({ success: true, vendorSlug });
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Login failed";
    console.error("Login failed:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
