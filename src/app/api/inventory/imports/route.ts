import { NextRequest, NextResponse } from "next/server";
import { connectDB } from "@/lib/db/connection";
import { InventoryImport } from "@/lib/db/models/InventoryImport";
import { InventoryItem } from "@/lib/db/models/InventoryItem";

/**
 * GET /api/inventory/imports
 *
 * Returns the most recent import batches plus the freshness of the catalog
 * (timestamp of the last completed import).
 */
export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 100);

  await connectDB();

  const [imports, lastImport, itemCount] = await Promise.all([
    InventoryImport.find({}).sort({ importedAt: -1 }).limit(limit).lean(),
    InventoryImport.findOne({}).sort({ importedAt: -1 }).lean(),
    InventoryItem.countDocuments({}),
  ]);

  return NextResponse.json({
    imports: imports.map((i) => ({
      id: String(i._id),
      importedAt: i.importedAt,
      importedBy: i.importedBy,
      reportDate: i.reportDate,
      files: i.files,
      result: i.result,
    })),
    catalog: {
      itemCount,
      lastImportedAt: lastImport?.importedAt ?? null,
      lastReportDate: lastImport?.reportDate ?? null,
    },
  });
}
