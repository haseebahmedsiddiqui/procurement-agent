import { NextRequest, NextResponse } from "next/server";
import { normalizeItems } from "@/lib/ai/item-normalizer";
import type { ParsedRFQItem } from "@/lib/parsers/rfq-parser";

export async function POST(request: NextRequest) {
  try {
    const { items, vendorSlugs } = (await request.json()) as {
      items: ParsedRFQItem[];
      vendorSlugs: string[];
    };

    if (!items?.length || !vendorSlugs?.length) {
      return NextResponse.json(
        { error: "items and vendorSlugs are required" },
        { status: 400 }
      );
    }

    const normalized = await normalizeItems(items, vendorSlugs);

    return NextResponse.json({ normalized });
  } catch (error) {
    console.error("Normalization failed:", error);
    const message =
      error instanceof Error ? error.message : "Normalization failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
