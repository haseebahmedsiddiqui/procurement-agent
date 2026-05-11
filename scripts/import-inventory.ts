import { loadEnvConfig } from "@next/env";
loadEnvConfig(process.cwd());

import fs from "node:fs";
import path from "node:path";

/**
 * Import Delaware Ship Supply inventory PDFs into the DB.
 *
 * Usage:
 *   npx tsx scripts/import-inventory.ts <pdf1> [pdf2 ...] [--dry-run] [--owner USER_ID]
 *
 * Accepts the ICR740 "Warehouse/Item Listing" and/or ICR720 "Item Sales Report"
 * exports in any order. Files are auto-detected by header. At least one file
 * is required.
 *
 * The import is idempotent: re-running with the same files updates existing
 * records in place (no duplicate inserts).
 */

const args = process.argv.slice(2);

function getArg(flag: string): string | null {
  const i = args.indexOf(flag);
  return i >= 0 && i + 1 < args.length ? args[i + 1] : null;
}

const DRY_RUN = args.includes("--dry-run");
const OWNER_ID = getArg("--owner");
const IMPORTED_BY = getArg("--by");

// Positional args = file paths
const files = args.filter((a) => !a.startsWith("--") && !isFlagValue(a));

function isFlagValue(arg: string): boolean {
  const idx = args.indexOf(arg);
  if (idx === 0) return false;
  const prev = args[idx - 1];
  return prev === "--owner" || prev === "--by";
}

if (files.length === 0) {
  console.error(
    "Usage: npx tsx scripts/import-inventory.ts <pdf1> [pdf2 ...] [--dry-run] [--owner USER_ID] [--by EMAIL]"
  );
  process.exit(1);
}

for (const f of files) {
  if (!fs.existsSync(f)) {
    console.error(`File not found: ${f}`);
    process.exit(1);
  }
}

async function main() {
  const { runImport } = await import("../src/lib/inventory/importer");

  const absolutePaths = files.map((f) => path.resolve(f));
  console.log(`[import] ${absolutePaths.length} file(s):`);
  for (const p of absolutePaths) console.log(`  - ${p}`);
  if (DRY_RUN) console.log("[import] DRY RUN — nothing will be written");

  const summary = await runImport(
    absolutePaths.map((p) => ({ path: p })),
    {
      ownerId: OWNER_ID,
      importedBy: IMPORTED_BY,
      dryRun: DRY_RUN,
    }
  );

  console.log("\n=== IMPORT SUMMARY ===");
  if (summary.reportDate) {
    console.log(`Source report date: ${summary.reportDate.toISOString().slice(0, 10)}`);
  }
  for (const f of summary.files) {
    console.log(`  ${f.name}: type=${f.type}, rows=${f.rowCount}`);
  }
  console.log(`Created:    ${summary.created}`);
  console.log(`Updated:    ${summary.updated}`);
  console.log(`Unchanged:  ${summary.unchanged}`);
  console.log(`Masked:     ${summary.masked}`);
  if (summary.parseErrors.length) {
    console.log(`Parse errors: ${summary.parseErrors.length}`);
    for (const e of summary.parseErrors.slice(0, 10)) {
      console.log(`  line ${e.line}: ${e.reason}`);
    }
    if (summary.parseErrors.length > 10) {
      console.log(`  ... ${summary.parseErrors.length - 10} more`);
    }
  }
  if (summary.importId) console.log(`Import ID: ${summary.importId}`);

  const mongoose = await import("mongoose");
  await mongoose.default.disconnect();
  process.exit(0);
}

main().catch(async (err) => {
  console.error("Import failed:", err instanceof Error ? err.message : err);
  if (err instanceof Error && err.stack) console.error(err.stack);
  try {
    const mongoose = await import("mongoose");
    await mongoose.default.disconnect();
  } catch {
    // ignore
  }
  process.exit(1);
});
