import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/connection";
import { Vendor } from "@/lib/db/models/Vendor";
import {
  importCookiesForVendor,
  parseCookieJson,
} from "@/lib/auth/cookie-import";
import { logger } from "@/lib/logger";

/**
 * POST /api/vendors/auth/upload-cookies
 *
 * Operator uploads a Cookie-Editor JSON export from their browser to refresh
 * a vendor's session without needing SSH access. Replaces the existing
 * /sessions/<slug>.session.json with new cookies.
 *
 * Body: multipart/form-data with fields:
 *   - file       (required) — Cookie-Editor JSON export
 *   - vendorSlug (required) — vendor to update (e.g. "mcmaster")
 *   - days       (optional) — session validity, defaults to vendor's
 *                             sessionMaxAgeHours/24 or 14 days fallback
 */
export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file");
    const vendorSlug = (formData.get("vendorSlug") || "").toString().trim();
    const daysRaw = formData.get("days")?.toString().trim();

    if (!vendorSlug) {
      return NextResponse.json(
        { error: "vendorSlug is required" },
        { status: 400 }
      );
    }

    if (!file || typeof file === "string") {
      return NextResponse.json(
        { error: "file is required (multipart upload)" },
        { status: 400 }
      );
    }

    await connectDB();

    const vendor = await Vendor.findOne({ slug: vendorSlug }).lean();
    if (!vendor) {
      return NextResponse.json(
        { error: `Unknown vendor: ${vendorSlug}` },
        { status: 404 }
      );
    }

    let days = parseInt(daysRaw || "", 10);
    if (!Number.isFinite(days) || days <= 0) {
      const vendorDays = vendor.sessionMaxAgeHours
        ? Math.max(1, Math.floor(vendor.sessionMaxAgeHours / 24))
        : 14;
      days = vendorDays;
    }
    days = Math.min(Math.max(1, days), 90);

    const text = await (file as File).text();
    let cookies;
    try {
      cookies = parseCookieJson(text);
    } catch (err) {
      return NextResponse.json(
        {
          error:
            err instanceof Error
              ? err.message
              : "Cookie file could not be parsed",
        },
        { status: 400 }
      );
    }

    if (cookies.length === 0) {
      return NextResponse.json(
        { error: "Cookie file contained no entries" },
        { status: 400 }
      );
    }

    const result = await importCookiesForVendor(vendorSlug, cookies, days);

    logger.info(
      {
        vendorSlug,
        cookieCount: result.cookieCount,
        days,
        expiresAt: result.expiresAt,
      },
      "Cookies imported via Settings UI"
    );

    return NextResponse.json({
      success: true,
      vendorSlug,
      cookieCount: result.cookieCount,
      savedAt: result.savedAt,
      expiresAt: result.expiresAt,
    });
  } catch (err) {
    logger.error({ error: err }, "Cookie upload failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Upload failed" },
      { status: 500 }
    );
  }
}
