import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { logger } from "@/lib/logger";

const execFileP = promisify(execFile);

export type ReportType = "item-listing" | "sales-report" | "unknown";

export interface SalesPeriodFigures {
  units: number;
  salesUsd: number;
  costUsd: number;
  marginUsd: number;
  marginPct: number;
}

export interface SalesReportRow {
  itemCode: string;
  description: string;
  unitOfMeasure: string;
  lastSaleDate: Date | null;
  isMasked: boolean;
  mtd: SalesPeriodFigures;
  ytd: SalesPeriodFigures;
  pyr: SalesPeriodFigures;
}

export interface ItemListingRow {
  itemCode: string;
  description: string;
  unitOfMeasure: string;
  rank: "A" | "B" | "C" | "D" | "E" | null;
  primaryLocation: string | null;
  isMasked: boolean;
}

export interface ParseError {
  itemCode?: string;
  line: number;
  reason: string;
}

export interface ParseResult<T> {
  rows: T[];
  errors: ParseError[];
  reportDate: Date | null;
}

const MASKED_DESCRIPTION_RE = /^\*+$/;
const DATE_RE = /^\d{2}\/\d{2}\/\d{2}$/;
// Numbers in the report always include a decimal point: 33.05, 1,234.56, .00, .0
const PERCENT_RE = /^-?[\d,]*\.?\d+%$/;
const MONEY_RE = /^-?[\d,]*\.\d+$/;
const UNITS_RE = /^-?[\d,]*\.\d+$/;
const UM_RE = /^[A-Z]{1,3}$/;
const PERIOD_TAG_RE = /^(MTD|YTD|PYR)$/;
const RANK_RE = /^[A-E]$/;
const REPORT_DATE_RE = /^Date:\s*(\d{2})\/(\d{2})\/(\d{2})/;

/**
 * Run `pdftotext -layout` on a PDF file. Requires poppler-utils to be installed
 * on the host (apt: poppler-utils ; brew: poppler ; Windows: bundled with Git).
 */
export async function pdfToText(filePath: string): Promise<string> {
  try {
    const { stdout } = await execFileP("pdftotext", ["-layout", filePath, "-"], {
      maxBuffer: 64 * 1024 * 1024,
    });
    return stdout;
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    if (message.includes("ENOENT")) {
      throw new Error(
        "pdftotext is not installed. Install poppler-utils: " +
          "apt install poppler-utils (Debian/Ubuntu) or brew install poppler (macOS)."
      );
    }
    throw err;
  }
}

export function detectReportType(text: string): ReportType {
  // Look in the first 2KB — the report header is on page 1
  const head = text.slice(0, 2000);
  if (head.includes("ICR720") || head.includes("ITEM SALES REPORT")) {
    return "sales-report";
  }
  if (head.includes("ICR740") || head.includes("Warehouse/Item Listing")) {
    return "item-listing";
  }
  return "unknown";
}

function extractReportDate(text: string): Date | null {
  const head = text.slice(0, 2000);
  for (const line of head.split("\n")) {
    const m = line.match(REPORT_DATE_RE);
    if (m) {
      const [, mm, dd, yy] = m;
      // Two-digit year: 00-69 → 2000s, 70-99 → 1900s. Source data starts 1999.
      const year = parseInt(yy, 10);
      const fullYear = year < 70 ? 2000 + year : 1900 + year;
      const d = new Date(fullYear, parseInt(mm, 10) - 1, parseInt(dd, 10));
      return isNaN(d.getTime()) ? null : d;
    }
  }
  return null;
}

function parseMoney(s: string): number {
  if (!s) return 0;
  const cleaned = s.replace(/,/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function parsePercent(s: string): number {
  if (!s) return 0;
  const n = parseFloat(s.replace(/[,%]/g, ""));
  return isNaN(n) ? 0 : n;
}

function parseDateMMDDYY(s: string): Date | null {
  if (!DATE_RE.test(s)) return null;
  const [mm, dd, yy] = s.split("/").map((x) => parseInt(x, 10));
  const fullYear = yy < 70 ? 2000 + yy : 1900 + yy;
  const d = new Date(fullYear, mm - 1, dd);
  return isNaN(d.getTime()) ? null : d;
}

const EMPTY_FIGURES: SalesPeriodFigures = {
  units: 0,
  salesUsd: 0,
  costUsd: 0,
  marginUsd: 0,
  marginPct: 0,
};

/**
 * Parse the trailing `units UM sales cost margin pct% PERIOD` portion that
 * appears at the end of every sales row.
 *
 * Returns null if the suffix doesn't match the expected shape.
 */
function parseSalesSuffix(
  tokens: string[]
): { period: "MTD" | "YTD" | "PYR"; figures: SalesPeriodFigures; consumedFromEnd: number } | null {
  if (tokens.length < 7) return null;
  const n = tokens.length;
  const period = tokens[n - 1];
  if (!PERIOD_TAG_RE.test(period)) return null;
  const pct = tokens[n - 2];
  if (!PERCENT_RE.test(pct)) return null;

  const marginUsd = tokens[n - 3];
  const costUsd = tokens[n - 4];
  const salesUsd = tokens[n - 5];
  const um = tokens[n - 6];
  const units = tokens[n - 7];

  if (
    !MONEY_RE.test(marginUsd) ||
    !MONEY_RE.test(costUsd) ||
    !MONEY_RE.test(salesUsd) ||
    !UM_RE.test(um) ||
    !UNITS_RE.test(units)
  ) {
    return null;
  }

  return {
    period: period as "MTD" | "YTD" | "PYR",
    figures: {
      units: parseMoney(units),
      salesUsd: parseMoney(salesUsd),
      costUsd: parseMoney(costUsd),
      marginUsd: parseMoney(marginUsd),
      marginPct: parsePercent(pct),
    },
    consumedFromEnd: 7,
  };
}

/**
 * Parse the ICR720 "Item Sales Report" output.
 *
 * Each item produces three lines: MTD, YTD, PYR. The MTD line carries the
 * item code, description, and (optionally) the last sale date. The next two
 * lines have only the figures and a period tag.
 */
export function parseSalesReport(text: string): ParseResult<SalesReportRow> {
  const lines = text.split("\n");
  const rows: SalesReportRow[] = [];
  const errors: ParseError[] = [];
  const reportDate = extractReportDate(text);

  let current: SalesReportRow | null = null;

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("Date:")) continue;
    if (trimmed.startsWith("User:")) continue;
    if (trimmed.startsWith("Warehouse ")) continue;
    if (trimmed.startsWith("ITEM ")) continue;
    if (trimmed.startsWith("VENDOR ")) continue;
    if (trimmed.startsWith("===")) continue;
    if (trimmed.startsWith("---")) continue;
    if (trimmed.startsWith("ITEM FIRST")) continue;
    if (trimmed.startsWith("WAREHOUSE TOTAL")) continue;
    if (trimmed.startsWith("REPORT TOTAL")) continue;
    if (/^Items?\s*:/i.test(trimmed)) continue;

    const tokens = trimmed.split(/\s+/);
    const suffix = parseSalesSuffix(tokens);
    if (!suffix) continue;

    const isMasterLine = !raw.startsWith(" "); // item code at column 0
    const head = tokens.slice(0, tokens.length - suffix.consumedFromEnd);

    if (isMasterLine && suffix.period === "MTD") {
      // Persist any previous record (defensive — should have been flushed on PYR)
      if (current) {
        rows.push(current);
        current = null;
      }

      const itemCode = head[0];
      const rest = head.slice(1);

      // Optional last sale date sits at the end of `rest`
      let lastSaleDate: Date | null = null;
      let descTokens = rest;
      if (rest.length > 0 && DATE_RE.test(rest[rest.length - 1])) {
        lastSaleDate = parseDateMMDDYY(rest[rest.length - 1]);
        descTokens = rest.slice(0, -1);
      }
      const description = descTokens.join(" ").trim();
      const isMasked = MASKED_DESCRIPTION_RE.test(description.replace(/\s+/g, ""));

      current = {
        itemCode,
        description: isMasked ? "" : description,
        unitOfMeasure: tokens[tokens.length - 6],
        lastSaleDate,
        isMasked,
        mtd: suffix.figures,
        ytd: { ...EMPTY_FIGURES },
        pyr: { ...EMPTY_FIGURES },
      };
    } else if (current && suffix.period === "YTD") {
      current.ytd = suffix.figures;
    } else if (current && suffix.period === "PYR") {
      current.pyr = suffix.figures;
      rows.push(current);
      current = null;
    } else {
      // Out-of-order line — record an error and move on
      errors.push({
        line: i + 1,
        reason: `Unexpected ${suffix.period} line with no active item`,
      });
    }
  }

  // Flush trailing item if file ended mid-record
  if (current) rows.push(current);

  logger.info(
    { rows: rows.length, errors: errors.length, reportDate },
    "Parsed sales report"
  );
  return { rows, errors, reportDate };
}

/**
 * Parse the ICR740 "Warehouse/Item Listing" output.
 *
 * Each row carries the item code, description, UM, ABC rank, usage method,
 * optional shelf location, three dates, and a card flag (Y/N). Some rows in
 * the source PDF have no description because the column overflows to a
 * separate area — we capture what we can and skip rows we can't anchor.
 */
export function parseItemListing(text: string): ParseResult<ItemListingRow> {
  const lines = text.split("\n");
  const rows: ItemListingRow[] = [];
  const errors: ParseError[] = [];
  const reportDate = extractReportDate(text);
  const seen = new Set<string>();

  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i];
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (trimmed.startsWith("Date:")) continue;
    if (trimmed.startsWith("User:")) continue;
    if (trimmed.startsWith("Warehouse ")) continue;
    if (trimmed.startsWith("Vendor ")) continue;
    if (trimmed.startsWith("Item ")) continue;
    if (trimmed.startsWith("Company Rank")) continue;
    if (trimmed.startsWith("===")) continue;
    if (trimmed.startsWith("---")) continue;
    if (/^Item\s*Count\b/i.test(trimmed)) continue;
    if (/RK=/i.test(trimmed)) continue;
    if (trimmed.startsWith("ST ")) continue;

    // Must start with a non-whitespace item code at column 0
    if (raw.startsWith(" ")) continue;

    const tokens = trimmed.split(/\s+/);
    if (tokens.length < 5) continue;

    // End anchor: card flag (Y/N) — last token
    const cardFlag = tokens[tokens.length - 1];
    if (cardFlag !== "Y" && cardFlag !== "N") continue;

    // The three dates appear in positions -4, -3, -2
    const created = tokens[tokens.length - 4];
    const lastInv = tokens[tokens.length - 3];
    const nextInv = tokens[tokens.length - 2];
    if (!DATE_RE.test(created) || !DATE_RE.test(lastInv) || !DATE_RE.test(nextInv)) {
      continue;
    }

    const itemCode = tokens[0];
    if (seen.has(itemCode)) continue; // PDF pagination can repeat header rows
    seen.add(itemCode);

    // Middle = description + UM + RK + U + (optional location)
    const middle = tokens.slice(1, tokens.length - 4);

    // Optional location code (1-4 alphanumeric) at the end of middle
    let primaryLocation: string | null = null;
    let scan = middle;
    if (scan.length > 0 && /^[A-Z0-9]{2,5}$/.test(scan[scan.length - 1])) {
      const candidate = scan[scan.length - 1];
      // Heuristic: location codes have at least one digit (e.g. 203C, 65A).
      // Pure-letter trailing tokens are part of the description.
      if (/\d/.test(candidate)) {
        primaryLocation = candidate;
        scan = scan.slice(0, -1);
      }
    }

    // After stripping location, the trailing tokens are: ... UM RK U
    // U is a single letter (B/F/T); RK is a single letter (A-E); UM is 1-3 letters.
    let unitOfMeasure = "";
    let rank: ItemListingRow["rank"] = null;
    if (scan.length >= 3) {
      const u = scan[scan.length - 1];
      const rk = scan[scan.length - 2];
      const um = scan[scan.length - 3];
      if (/^[BFT]$/.test(u) && RANK_RE.test(rk) && UM_RE.test(um)) {
        unitOfMeasure = um;
        rank = rk as ItemListingRow["rank"];
        scan = scan.slice(0, -3);
      }
    }

    const description = scan.join(" ").trim();
    const isMasked = MASKED_DESCRIPTION_RE.test(description.replace(/\s+/g, ""));

    rows.push({
      itemCode,
      description: isMasked ? "" : description,
      unitOfMeasure,
      rank,
      primaryLocation,
      isMasked,
    });
  }

  logger.info(
    { rows: rows.length, errors: errors.length, reportDate },
    "Parsed item listing"
  );
  return { rows, errors, reportDate };
}
