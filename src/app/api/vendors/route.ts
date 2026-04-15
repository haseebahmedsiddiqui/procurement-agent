import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { connectDB } from "@/lib/db/connection";
import { Vendor } from "@/lib/db/models/Vendor";
import { Category } from "@/lib/db/models/Category";
import { logger } from "@/lib/logger";
import { validateUrl, slugify } from "@/lib/security/url-validation";

export async function GET() {
  try {
    await connectDB();

    const [vendors, categories] = await Promise.all([
      Vendor.find({ enabled: true }).lean(),
      Category.find().lean(),
    ]);

    return NextResponse.json({ vendors, categories });
  } catch (error) {
    logger.error({ error }, "Failed to fetch vendors");
    return NextResponse.json(
      { error: "Failed to fetch vendors" },
      { status: 500 }
    );
  }
}

const CreateVendorSchema = z.object({
  name: z.string().min(2).max(80),
  category: z.enum(["stationery", "deck_engine", "galley_kitchen"]),
  baseUrl: z.string().url(),
  searchUrlPattern: z.string().min(10),
  extractionHints: z.string().max(500).optional(),
  searchQueryTemplate: z.string().max(500).optional(),
});

/**
 * POST /api/vendors
 *
 * Create a user-added custom store. The vendor uses the GenericAdapter
 * (HTTP+LLM, no auth) by default. Validates URLs to prevent SSRF.
 */
export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const parsed = CreateVendorSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "Invalid input", issues: parsed.error.flatten() },
        { status: 400 }
      );
    }
    const data = parsed.data;

    // Validate the search URL pattern: must contain {{query}} and be safe
    if (!data.searchUrlPattern.includes("{{query}}")) {
      return NextResponse.json(
        { error: "searchUrlPattern must contain {{query}}" },
        { status: 400 }
      );
    }
    const sampleSearchUrl = data.searchUrlPattern.replace("{{query}}", "test");
    const baseCheck = validateUrl(data.baseUrl);
    if (!baseCheck.ok) {
      return NextResponse.json({ error: `baseUrl: ${baseCheck.reason}` }, { status: 400 });
    }
    const searchCheck = validateUrl(sampleSearchUrl);
    if (!searchCheck.ok) {
      return NextResponse.json(
        { error: `searchUrlPattern: ${searchCheck.reason}` },
        { status: 400 }
      );
    }

    await connectDB();

    // Generate a unique slug
    let slug = slugify(data.name);
    if (!slug) slug = `custom-${Date.now()}`;
    const existing = await Vendor.findOne({ slug });
    if (existing) {
      slug = `${slug}-${Date.now().toString(36)}`;
    }

    const vendor = await Vendor.create({
      name: data.name,
      slug,
      category: data.category,
      enabled: true,
      baseUrl: data.baseUrl,
      searchUrlPattern: data.searchUrlPattern,
      authRequired: false,
      authType: "none",
      preferredStrategy: "http",
      needsJsRendering: false,
      rateLimitMs: 2000,
      cacheFreshnessHours: 24,
      extractionHints: data.extractionHints || "",
      searchQueryTemplate: data.searchQueryTemplate || "",
      healthStatus: "healthy",
    });

    logger.info(
      { slug: vendor.slug, name: vendor.name, category: vendor.category },
      "Custom vendor created"
    );

    return NextResponse.json({
      success: true,
      vendor: {
        slug: vendor.slug,
        name: vendor.name,
        category: vendor.category,
      },
    });
  } catch (err) {
    logger.error({ error: err }, "Custom vendor create failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Create failed" },
      { status: 500 }
    );
  }
}
