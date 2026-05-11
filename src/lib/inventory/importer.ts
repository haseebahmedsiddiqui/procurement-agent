import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Types } from "mongoose";
import { connectDB } from "@/lib/db/connection";
import { InventoryItem } from "@/lib/db/models/InventoryItem";
import { InventoryImport } from "@/lib/db/models/InventoryImport";
import { logger } from "@/lib/logger";
import {
  detectReportType,
  parseItemListing,
  parseSalesReport,
  pdfToText,
  type ItemListingRow,
  type SalesReportRow,
  type ReportType,
  type ParseError,
} from "./pdf-parser";

const ACTIVE_LAST_SALE_DAYS = 18 * 30; // ~18 months

export interface ImportFileInput {
  path: string;
  /** Override report-type detection (rarely needed). */
  type?: ReportType;
}

export interface ImportOptions {
  ownerId?: string | null;
  importedBy?: string | null;
  dryRun?: boolean;
}

export interface ImportSummary {
  importId: string | null;
  files: Array<{
    name: string;
    type: ReportType;
    rowCount: number;
    sha256: string;
  }>;
  created: number;
  updated: number;
  unchanged: number;
  masked: number;
  parseErrors: ParseError[];
  reportDate: Date | null;
}

async function sha256(filePath: string): Promise<string> {
  const buf = await fs.readFile(filePath);
  return crypto.createHash("sha256").update(buf).digest("hex");
}

interface MergedRow {
  itemCode: string;
  fromSales?: SalesReportRow;
  fromListing?: ItemListingRow;
}

function mergeRows(
  sales: SalesReportRow[],
  listing: ItemListingRow[]
): MergedRow[] {
  const byCode = new Map<string, MergedRow>();
  for (const r of sales) {
    byCode.set(r.itemCode, { itemCode: r.itemCode, fromSales: r });
  }
  for (const r of listing) {
    const existing = byCode.get(r.itemCode);
    if (existing) existing.fromListing = r;
    else byCode.set(r.itemCode, { itemCode: r.itemCode, fromListing: r });
  }
  return [...byCode.values()];
}

function deriveActive(row: SalesReportRow | undefined): boolean {
  if (!row) return false;
  if (row.pyr.units > 0 || row.ytd.units > 0 || row.mtd.units > 0) return true;
  if (row.lastSaleDate) {
    const ageDays = (Date.now() - row.lastSaleDate.getTime()) / 86400000;
    if (ageDays <= ACTIVE_LAST_SALE_DAYS) return true;
  }
  return false;
}

function deriveUnitCost(row: SalesReportRow | undefined): number | null {
  if (!row) return null;
  // Prefer PYR (largest sample), fall back to YTD, then MTD
  for (const period of [row.pyr, row.ytd, row.mtd]) {
    if (period.units > 0 && period.costUsd > 0) {
      return Number((period.costUsd / period.units).toFixed(4));
    }
  }
  return null;
}

export async function runImport(
  files: ImportFileInput[],
  opts: ImportOptions = {}
): Promise<ImportSummary> {
  const { ownerId = null, importedBy = null, dryRun = false } = opts;

  // 1. Read + classify files
  const fileMeta: ImportSummary["files"] = [];
  const allSales: SalesReportRow[] = [];
  const allListing: ItemListingRow[] = [];
  const parseErrors: ParseError[] = [];
  let reportDate: Date | null = null;
  const sourceReportsByCode = new Map<string, Set<"item-listing" | "sales-report">>();

  for (const f of files) {
    const text = await pdfToText(f.path);
    const detected = f.type ?? detectReportType(text);
    const hash = await sha256(f.path);
    const baseName = path.basename(f.path);

    if (detected === "sales-report") {
      const { rows, errors, reportDate: rd } = parseSalesReport(text);
      allSales.push(...rows);
      parseErrors.push(...errors);
      if (rd && !reportDate) reportDate = rd;
      fileMeta.push({ name: baseName, type: detected, rowCount: rows.length, sha256: hash });
      for (const r of rows) {
        const set = sourceReportsByCode.get(r.itemCode) ?? new Set();
        set.add("sales-report");
        sourceReportsByCode.set(r.itemCode, set);
      }
    } else if (detected === "item-listing") {
      const { rows, errors, reportDate: rd } = parseItemListing(text);
      allListing.push(...rows);
      parseErrors.push(...errors);
      if (rd && !reportDate) reportDate = rd;
      fileMeta.push({ name: baseName, type: detected, rowCount: rows.length, sha256: hash });
      for (const r of rows) {
        const set = sourceReportsByCode.get(r.itemCode) ?? new Set();
        set.add("item-listing");
        sourceReportsByCode.set(r.itemCode, set);
      }
    } else {
      fileMeta.push({ name: baseName, type: "unknown", rowCount: 0, sha256: hash });
      parseErrors.push({
        line: 0,
        reason: `Could not detect report type for ${baseName}`,
      });
    }
  }

  const merged = mergeRows(allSales, allListing);
  logger.info(
    {
      filesIn: files.length,
      sales: allSales.length,
      listing: allListing.length,
      merged: merged.length,
    },
    "Inventory parse complete"
  );

  if (dryRun) {
    const maskedCount = merged.filter(
      (m) => m.fromSales?.isMasked || m.fromListing?.isMasked
    ).length;
    return {
      importId: null,
      files: fileMeta,
      created: 0,
      updated: 0,
      unchanged: 0,
      masked: maskedCount,
      parseErrors,
      reportDate,
    };
  }

  // 2. Open the import audit doc first so item records can reference it
  await connectDB();
  const importDoc = await InventoryImport.create({
    ownerId,
    importedBy,
    files: fileMeta,
    reportDate,
  });
  const importId = importDoc._id as Types.ObjectId;

  // 3. Upsert each merged row
  let created = 0;
  let updated = 0;
  let unchanged = 0;
  let masked = 0;

  for (const m of merged) {
    const sales = m.fromSales;
    const listing = m.fromListing;
    const isMasked = Boolean(sales?.isMasked || listing?.isMasked);
    if (isMasked) masked++;

    const description =
      (sales?.description && sales.description.length > 0
        ? sales.description
        : listing?.description) ?? "";

    const update: Record<string, unknown> = {
      ownerId,
      itemCode: m.itemCode,
      isMasked,
      lastSeenInImportId: importId,
      importedAt: new Date(),
      sourceReports: [...(sourceReportsByCode.get(m.itemCode) ?? [])],
    };

    if (description) update.description = description;

    if (sales) {
      update.unitOfMeasure = sales.unitOfMeasure || undefined;
      update.lastSaleDate = sales.lastSaleDate;
      update.sales = {
        mtd: sales.mtd,
        ytd: sales.ytd,
        pyr: sales.pyr,
      };
      update.derivedUnitCost = deriveUnitCost(sales);
      update.isActive = deriveActive(sales);
    }

    if (listing) {
      if (listing.unitOfMeasure) update.unitOfMeasure = listing.unitOfMeasure;
      if (listing.rank) update.rank = listing.rank;
      if (listing.primaryLocation) update.primaryLocation = listing.primaryLocation;
    }

    const existing = await InventoryItem.findOne({
      ownerId,
      itemCode: m.itemCode,
    }).lean();

    if (!existing) {
      await InventoryItem.create(update);
      created++;
      continue;
    }

    // Detect actual change vs no-op update
    const changed =
      (description && existing.description !== description) ||
      (sales &&
        (existing.derivedUnitCost !== update.derivedUnitCost ||
          existing.isActive !== update.isActive ||
          (existing.lastSaleDate?.getTime?.() ?? 0) !==
            (sales.lastSaleDate?.getTime() ?? 0))) ||
      (listing &&
        (existing.rank !== (listing.rank ?? existing.rank) ||
          existing.primaryLocation !==
            (listing.primaryLocation ?? existing.primaryLocation)));

    await InventoryItem.updateOne({ ownerId, itemCode: m.itemCode }, { $set: update });
    if (changed) updated++;
    else unchanged++;
  }

  // 4. Persist the result counts on the import audit doc
  await InventoryImport.updateOne(
    { _id: importId },
    {
      $set: {
        "result.created": created,
        "result.updated": updated,
        "result.unchanged": unchanged,
        "result.masked": masked,
        "result.parseErrors": parseErrors,
      },
    }
  );

  logger.info(
    { importId: importId.toString(), created, updated, unchanged, masked },
    "Inventory import complete"
  );

  return {
    importId: importId.toString(),
    files: fileMeta,
    created,
    updated,
    unchanged,
    masked,
    parseErrors,
    reportDate,
  };
}
