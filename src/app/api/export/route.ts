import { NextRequest, NextResponse } from "next/server";
import ExcelJS from "exceljs";
import { logger } from "@/lib/logger";

interface ExportItem {
  lineNumber: number;
  description: string;
  impaCode?: string;
  quantity: number;
  unit: string;
}

interface ExportVendorResult {
  vendorSlug: string;
  productName?: string;
  productId?: string;
  productUrl?: string;
  price?: number;
  currency?: string;
  inStock?: boolean;
  source?: string;
  error?: string;
}

interface ExportRequest {
  filename?: string;
  items: ExportItem[];
  vendorSlugs: string[];
  /** Map of itemIndex → vendor results array. */
  results: Record<string, ExportVendorResult[]>;
}

/**
 * POST /api/export
 *
 * Generate an Excel workbook with one row per RFQ item and one column-group
 * per selected vendor (product name, price, link). Highlights the cheapest
 * in-stock vendor per row in green so a procurement officer can scan a
 * 200-line RFQ and immediately see who wins each line.
 */
export async function POST(request: NextRequest) {
  try {
    const body = (await request.json()) as ExportRequest;
    const { items, vendorSlugs, results, filename } = body;

    if (!Array.isArray(items) || items.length === 0) {
      return NextResponse.json(
        { error: "items array is required" },
        { status: 400 }
      );
    }
    if (!Array.isArray(vendorSlugs) || vendorSlugs.length === 0) {
      return NextResponse.json(
        { error: "vendorSlugs array is required" },
        { status: 400 }
      );
    }

    const workbook = new ExcelJS.Workbook();
    workbook.creator = "Procurement Agent";
    workbook.created = new Date();

    const sheet = workbook.addWorksheet("Price Comparison", {
      views: [{ state: "frozen", ySplit: 1, xSplit: 4 }],
    });

    // Header row: fixed cols + 3 cols per vendor (Product, Price, Link)
    const headerRow: string[] = ["#", "Description", "IMPA", "Qty"];
    for (const slug of vendorSlugs) {
      headerRow.push(`${slug} — Product`, `${slug} — Price`, `${slug} — Link`);
    }
    headerRow.push("Best Vendor", "Best Price");
    sheet.addRow(headerRow);

    // Style header
    const header = sheet.getRow(1);
    header.font = { bold: true, color: { argb: "FFFFFFFF" } };
    header.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
    header.alignment = { vertical: "middle", horizontal: "left", wrapText: true };
    header.height = 22;

    // Column widths
    sheet.getColumn(1).width = 6;
    sheet.getColumn(2).width = 42;
    sheet.getColumn(3).width = 12;
    sheet.getColumn(4).width = 10;
    for (let v = 0; v < vendorSlugs.length; v++) {
      const base = 5 + v * 3;
      sheet.getColumn(base).width = 36; // Product
      sheet.getColumn(base + 1).width = 12; // Price
      sheet.getColumn(base + 2).width = 14; // Link
    }
    sheet.getColumn(5 + vendorSlugs.length * 3).width = 18; // Best Vendor
    sheet.getColumn(6 + vendorSlugs.length * 3).width = 12; // Best Price

    // Body rows
    items.forEach((item, idx) => {
      const itemResults = results[String(idx)] || [];

      // Find cheapest in-stock vendor for this row
      const priced = itemResults.filter(
        (r) => typeof r.price === "number" && r.inStock !== false && r.productName
      );
      let bestVendor: string | null = null;
      let bestPrice: number | null = null;
      if (priced.length > 0) {
        const cheapest = priced.reduce((min, r) =>
          (r.price ?? Infinity) < (min.price ?? Infinity) ? r : min
        );
        bestVendor = cheapest.vendorSlug;
        bestPrice = cheapest.price ?? null;
      }

      const row: (string | number | null)[] = [
        item.lineNumber,
        item.description,
        item.impaCode || "",
        `${item.quantity} ${item.unit}`,
      ];

      for (const slug of vendorSlugs) {
        const vr = itemResults.find((r) => r.vendorSlug === slug);
        if (!vr || !vr.productName) {
          row.push(vr?.error || "No result", "", "");
        } else {
          row.push(
            vr.productName,
            typeof vr.price === "number" ? vr.price : "",
            vr.productUrl || ""
          );
        }
      }

      row.push(bestVendor || "—", bestPrice ?? "");

      const xlsxRow = sheet.addRow(row);
      xlsxRow.alignment = { vertical: "top", wrapText: true };

      // Highlight the cheapest vendor's price cell in green
      if (bestVendor) {
        const vIdx = vendorSlugs.indexOf(bestVendor);
        if (vIdx >= 0) {
          const priceCol = 5 + vIdx * 3 + 1;
          const cell = xlsxRow.getCell(priceCol);
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFD1FAE5" },
          };
          cell.font = { bold: true, color: { argb: "FF065F46" } };
        }
      }

      // Format price columns as currency
      for (let v = 0; v < vendorSlugs.length; v++) {
        const priceCol = 5 + v * 3 + 1;
        const c = xlsxRow.getCell(priceCol);
        if (typeof c.value === "number") {
          c.numFmt = '"$"#,##0.00';
        }
      }
      const bestPriceCol = 6 + vendorSlugs.length * 3;
      const bestPriceCell = xlsxRow.getCell(bestPriceCol);
      if (typeof bestPriceCell.value === "number") {
        bestPriceCell.numFmt = '"$"#,##0.00';
        bestPriceCell.font = { bold: true };
      }

      // Hyperlinks for product links
      for (let v = 0; v < vendorSlugs.length; v++) {
        const linkCol = 5 + v * 3 + 2;
        const linkCell = xlsxRow.getCell(linkCol);
        const url = linkCell.value;
        if (typeof url === "string" && url.startsWith("http")) {
          linkCell.value = { text: "view", hyperlink: url };
          linkCell.font = { color: { argb: "FF2563EB" }, underline: true };
        }
      }
    });

    const buffer = await workbook.xlsx.writeBuffer();
    const safeName = (filename || "rfq-comparison")
      .replace(/[^a-z0-9-_]+/gi, "_")
      .slice(0, 80);

    logger.info(
      { items: items.length, vendors: vendorSlugs.length, filename: safeName },
      "Excel export generated"
    );

    return new NextResponse(buffer as ArrayBuffer, {
      status: 200,
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${safeName}.xlsx"`,
        "Cache-Control": "no-store",
      },
    });
  } catch (err) {
    logger.error({ error: err }, "Excel export failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Export failed" },
      { status: 500 }
    );
  }
}
