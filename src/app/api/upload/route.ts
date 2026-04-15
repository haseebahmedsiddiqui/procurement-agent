import { NextRequest, NextResponse } from "next/server";
import { parseRFQ } from "@/lib/parsers/rfq-parser";
import { detectCategory } from "@/lib/ai/category-detector";
import { connectDB } from "@/lib/db/connection";
import { RFQ } from "@/lib/db/models/RFQ";

export async function POST(request: NextRequest) {
  try {
    const formData = await request.formData();
    const file = formData.get("file") as File | null;

    if (!file) {
      return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
    }

    if (!file.name.endsWith(".xlsx") && !file.name.endsWith(".xls")) {
      return NextResponse.json(
        { error: "Only Excel files (.xlsx, .xls) are supported" },
        { status: 400 }
      );
    }

    // Parse Excel
    const buffer = Buffer.from(await file.arrayBuffer());
    const parsed = await parseRFQ(buffer, file.name);

    if (parsed.totalItems === 0) {
      return NextResponse.json(
        {
          error: "No items could be parsed from the file",
          warnings: parsed.parseWarnings,
        },
        { status: 400 }
      );
    }

    // Detect category via AI
    let detection;
    try {
      detection = await detectCategory(parsed.items);
    } catch (err) {
      // If AI fails (no API key, etc.), return parsed items without category
      console.error("Category detection failed:", err);
      detection = null;
    }

    // Save RFQ to database
    await connectDB();
    const rfq = await RFQ.create({
      filename: file.name,
      items: parsed.items,
      detectedCategory: detection?.primaryCategory || "stationery",
      categoryConfidence: detection?.overallConfidence || 0,
      status: "uploaded",
    });

    return NextResponse.json({
      rfqId: rfq._id,
      filename: parsed.filename,
      format: parsed.detectedFormat,
      totalItems: parsed.totalItems,
      items: parsed.items,
      warnings: parsed.parseWarnings,
      detection: detection || {
        primaryCategory: "stationery",
        isMixed: false,
        overallConfidence: 0,
        groups: [
          {
            category: "stationery",
            confidence: 0,
            itemIndices: parsed.items.map((_, i) => i),
            reasoning: "Category detection unavailable — defaulted to stationery",
          },
        ],
      },
    });
  } catch (error) {
    console.error("Upload failed:", error);
    const message = error instanceof Error ? error.message : "Upload failed";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
