import ExcelJS from "exceljs";
import { logger } from "@/lib/logger";

export interface ParsedRFQItem {
  lineNumber: number;
  description: string;
  impaCode?: string;
  quantity: number;
  unit: string;
  notes?: string;
}

export interface ParsedRFQ {
  filename: string;
  items: ParsedRFQItem[];
  detectedFormat: string;
  totalItems: number;
  parseWarnings: string[];
}

// Common column name patterns for auto-detection
const COLUMN_PATTERNS = {
  description: [
    /desc/i, /item\s*name/i, /product/i, /article/i, /material/i,
    /particulars/i, /specification/i, /^name$/i, /item\s*desc/i,
  ],
  impaCode: [
    // Broad leading-match catches IMPA, IMPA NO, IMPA CODE, IMPA NUMBER,
    // IMPA_NO, IMPA-CODE, IMPA Ref, etc. "IMPA SECTION" is excluded below.
    /^impa/i,
    /^code$/i, /item\s*code/i, /cat\s*no/i, /catalog/i,
  ],
  quantity: [
    /qty/i, /quantity/i, /^q$/i, /^qnty$/i, /required\s*qty/i,
    /order\s*qty/i, /^amount$/i,
  ],
  unit: [
    /unit/i, /uom/i, /u\/m/i, /^u$/i, /measure/i, /pack/i,
    /unit\s*of\s*measure/i,
  ],
  notes: [
    /note/i, /remark/i, /comment/i, /observation/i,
    /^reference$/i, /additional/i,
  ],
  lineNumber: [
    /^s\.?\s*no\.?$/i, /^sr\.?\s*no\.?$/i, /^no\.?$/i, /^#$/i, /^sl/i,
    /^line/i, /^item\s*no/i, /^seq/i, /^pos$/i,
  ],
};

export interface ColumnMapping {
  description: number | null;
  impaCode: number | null;
  quantity: number | null;
  unit: number | null;
  notes: number | null;
  lineNumber: number | null;
}

/**
 * Auto-detect column mappings from a header row.
 */
export function detectColumns(headers: string[]): ColumnMapping {
  const mapping: ColumnMapping = {
    description: null,
    impaCode: null,
    quantity: null,
    unit: null,
    notes: null,
    lineNumber: null,
  };

  // Normalize: collapse whitespace/newlines so "IMPA\nNO" becomes "IMPA NO"
  const normalized = headers.map((h) =>
    (h || "").replace(/[\s\n\r]+/g, " ").trim()
  );

  // Skip list: columns that look like IMPA but aren't the code column
  const skipImpa = /impa\s*section/i;

  for (let i = 0; i < normalized.length; i++) {
    const header = normalized[i];
    if (!header) continue;

    for (const [field, patterns] of Object.entries(COLUMN_PATTERNS)) {
      // For quantity: allow overwrite so the LAST matching QTY column wins
      // (handles multi-dept sheets where last QTY = TOTAL)
      if (field !== "quantity" && mapping[field as keyof ColumnMapping] !== null) continue;

      // Skip "IMPA SECTION" — it's not the code column
      if (field === "impaCode" && skipImpa.test(header)) continue;

      if (patterns.some((p) => p.test(header))) {
        mapping[field as keyof ColumnMapping] = i;
        break;
      }
    }
  }

  return mapping;
}

/**
 * Find the header row in a worksheet.
 * Scans first 10 rows looking for a row that matches known column patterns.
 */
function findHeaderRow(
  worksheet: ExcelJS.Worksheet
): { rowIndex: number; headers: string[] } | null {
  for (let rowIdx = 1; rowIdx <= Math.min(10, worksheet.rowCount); rowIdx++) {
    const row = worksheet.getRow(rowIdx);
    const values: string[] = [];
    let nonEmptyCount = 0;

    row.eachCell({ includeEmpty: true }, (cell, colNumber) => {
      const raw =
        cell.text?.toString().trim() ||
        (cell.value !== null && cell.value !== undefined ? String(cell.value) : "");
      const val = raw.replace(/[\s\n\r]+/g, " ").trim();
      values[colNumber - 1] = val;
      if (val) nonEmptyCount++;
    });

    if (nonEmptyCount < 2) continue;

    // Check if this row looks like a header
    const mapping = detectColumns(values);
    const detectedFields = Object.values(mapping).filter((v) => v !== null).length;

    // Need at least description + one other field to count as a header
    if (mapping.description !== null && detectedFields >= 2) {
      return { rowIndex: rowIdx, headers: values };
    }
  }

  return null;
}

function getCellValue(row: ExcelJS.Row, colIndex: number | null): string {
  if (colIndex === null) return "";
  const cell = row.getCell(colIndex + 1); // ExcelJS is 1-indexed

  // cell.text is empty for numeric/date cells that have no explicit format string.
  // Fall back to cell.value so IMPA codes stored as plain numbers are not dropped.
  const raw =
    cell.text?.toString().trim() ||
    (cell.value !== null && cell.value !== undefined ? String(cell.value) : "");

  return raw
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

export function parseQuantity(raw: string): { qty: number; wasZero: boolean } {
  const cleaned = raw.replace(/[^0-9.,-]/g, "").replace(",", ".");
  const num = parseFloat(cleaned);
  if (isNaN(num)) return { qty: 1, wasZero: false };
  if (num <= 0) return { qty: 1, wasZero: true };
  return { qty: Math.max(1, Math.round(num)), wasZero: false };
}

export const MAX_ITEMS = 2000;

/**
 * Parse an RFQ Excel file into structured items.
 */
export async function parseRFQ(
  buffer: Buffer,
  filename: string
): Promise<ParsedRFQ> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as unknown as ExcelJS.Buffer);

  const warnings: string[] = [];
  const allItems: ParsedRFQItem[] = [];
  let detectedFormat = "unknown";

  // Try each worksheet
  for (const worksheet of workbook.worksheets) {
    const headerResult = findHeaderRow(worksheet);

    if (!headerResult) {
      warnings.push(`Sheet "${worksheet.name}": no header row detected`);
      continue;
    }

    const { rowIndex, headers } = headerResult;
    const mapping = detectColumns(headers);

    if (mapping.description === null) {
      warnings.push(
        `Sheet "${worksheet.name}": found header row ${rowIndex} but no description column`
      );
      continue;
    }

    detectedFormat = detectFormat(headers);
    logger.info(
      {
        sheet: worksheet.name,
        headerRow: rowIndex,
        format: detectedFormat,
        mapping,
      },
      "Detected RFQ format"
    );

    // Parse data rows
    let lineNum = 0;
    let truncated = false;
    const seenKeys = new Set<string>();
    let duplicateCount = 0;

    for (let rowIdx = rowIndex + 1; rowIdx <= worksheet.rowCount; rowIdx++) {
      if (allItems.length >= MAX_ITEMS) {
        truncated = true;
        break;
      }

      const row = worksheet.getRow(rowIdx);

      const description = getCellValue(row, mapping.description);
      if (!description) continue; // Skip empty rows

      lineNum++;

      const impa = getCellValue(row, mapping.impaCode);

      // Dedup key: use IMPA+description combo when IMPA is present (same IMPA
      // can map to different sizes/colors), else just description.
      const dedupKey = impa
        ? `impa:${impa.toLowerCase()}:${description.toLowerCase()}`
        : `desc:${description.toLowerCase()}`;
      if (seenKeys.has(dedupKey)) {
        duplicateCount++;
        continue;
      }
      seenKeys.add(dedupKey);

      const { qty, wasZero } = parseQuantity(
        getCellValue(row, mapping.quantity) || "1"
      );
      if (wasZero) {
        warnings.push(
          `Line ${lineNum} ("${description.slice(0, 40)}"): zero/negative quantity, defaulting to 1`
        );
      }

      const item: ParsedRFQItem = {
        lineNumber: mapping.lineNumber !== null
          ? parseInt(getCellValue(row, mapping.lineNumber)) || lineNum
          : lineNum,
        description,
        quantity: qty,
        unit: getCellValue(row, mapping.unit) || "EA",
      };

      if (impa) item.impaCode = impa;

      const notes = getCellValue(row, mapping.notes);
      if (notes) item.notes = notes;

      allItems.push(item);
    }

    if (truncated) {
      warnings.push(
        `Truncated at ${MAX_ITEMS} items — RFQ exceeds maximum supported size`
      );
    }
    if (duplicateCount > 0) {
      warnings.push(`Skipped ${duplicateCount} duplicate item(s)`);
    }

    // Only parse first sheet with valid data
    if (allItems.length > 0) break;
  }

  if (allItems.length === 0) {
    warnings.push("No items could be parsed from any worksheet");
  }

  return {
    filename,
    items: allItems,
    detectedFormat,
    totalItems: allItems.length,
    parseWarnings: warnings,
  };
}

/**
 * Guess the RFQ format from headers for logging/display.
 */
export function detectFormat(headers: string[]): string {
  const joined = headers.join(" ").toLowerCase();

  if (joined.includes("impa") && joined.includes("particulars"))
    return "Isolde Maritime";
  if (joined.includes("impa")) return "Maritime (IMPA)";
  if (joined.includes("catalog") || joined.includes("cat no"))
    return "Catalog-based";
  if (joined.includes("sku") || joined.includes("item number"))
    return "SKU-based";

  return "Generic RFQ";
}
