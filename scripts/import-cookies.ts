import "dotenv/config";
import fs from "fs/promises";
import path from "path";

/**
 * Import Cookie-Editor JSON exports into the app's session store.
 *
 * Usage:
 *   npx tsx scripts/import-cookies.ts <cookies.json> <vendor-slug> [vendor-slug ...] [--days N]
 *
 * Example (one Amazon export → all 3 amazon adapter slugs, 14-day expiry):
 *   npx tsx scripts/import-cookies.ts ./amazon-cookies.json \
 *     amazon amazon-deck amazon-galley --days 14
 */

interface CookieEditorCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure?: boolean;
  httpOnly?: boolean;
  expirationDate?: number;
  session?: boolean;
  sameSite?: string | null;
}

interface PlaywrightCookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  expires: number;
  httpOnly: boolean;
  secure: boolean;
  sameSite: "Strict" | "Lax" | "None";
}

function mapSameSite(s: string | null | undefined): "Strict" | "Lax" | "None" {
  if (!s) return "Lax";
  const v = s.toLowerCase();
  if (v === "strict") return "Strict";
  if (v === "no_restriction" || v === "none") return "None";
  return "Lax";
}

function convert(cookies: CookieEditorCookie[]): PlaywrightCookie[] {
  return cookies.map((c) => ({
    name: c.name,
    value: c.value,
    domain: c.domain,
    path: c.path || "/",
    expires:
      c.session || !c.expirationDate ? -1 : Math.floor(c.expirationDate),
    httpOnly: !!c.httpOnly,
    secure: !!c.secure,
    sameSite: mapSameSite(c.sameSite),
  }));
}

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
  const exported: CookieEditorCookie[] = JSON.parse(raw);
  const cookies = convert(exported);

  const sessionsDir = path.join(process.cwd(), "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });

  const savedAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000
  ).toISOString();

  for (const slug of vendorSlugs) {
    const session = { vendorSlug: slug, cookies, savedAt, expiresAt };
    const dest = path.join(sessionsDir, `${slug}.session.json`);
    await fs.writeFile(dest, JSON.stringify(session, null, 2));
    console.log(`✓ wrote ${dest}  (${cookies.length} cookies, expires ${expiresAt})`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
