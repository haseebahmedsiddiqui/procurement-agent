import "dotenv/config";
import fs from "fs/promises";
import { parseCookieJson, importCookiesForVendor } from "../src/lib/auth/cookie-import";

/**
 * Import Cookie-Editor JSON exports into the app's session store.
 *
 * Usage:
 *   npx tsx scripts/import-cookies.ts <cookies.json> <vendor-slug> [vendor-slug ...] [--days N]
 *
 * Example (one Amazon export → all 3 amazon adapter slugs, 14-day expiry):
 *   npx tsx scripts/import-cookies.ts ./amazon-cookies.json \
 *     amazon amazon-deck amazon-galley --days 14
 *
 * For an in-app UI alternative, use Settings → Upload Cookies on each vendor card.
 */

async function main() {
  const args = process.argv.slice(2);
  if (args.length < 2) {
    console.error(
      "Usage: tsx scripts/import-cookies.ts <cookies.json> <vendor-slug> [...] [--days N]"
    );
    process.exit(1);
  }

  let days = 14;
  const daysIdx = args.indexOf("--days");
  if (daysIdx !== -1) {
    days = parseInt(args[daysIdx + 1], 10) || 14;
    args.splice(daysIdx, 2);
  }

  const [cookiesFile, ...vendorSlugs] = args;
  const raw = await fs.readFile(cookiesFile, "utf-8");
  const cookies = parseCookieJson(raw);

  for (const slug of vendorSlugs) {
    const result = await importCookiesForVendor(slug, cookies, days);
    console.log(
      `✓ wrote ${result.sessionFilePath}  (${result.cookieCount} cookies, expires ${result.expiresAt})`
    );
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
