import fs from "fs/promises";
import path from "path";

/**
 * Shared cookie-import utilities.
 *
 * Converts a Cookie-Editor browser-extension JSON export into the Playwright
 * cookie format and writes a session file under /sessions/<slug>.session.json.
 *
 * Used by both:
 *   - scripts/import-cookies.ts (CLI flow)
 *   - /api/vendors/auth/upload-cookies (Settings UI flow)
 */

export interface CookieEditorCookie {
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

export interface PlaywrightCookie {
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

export function convertCookies(cookies: CookieEditorCookie[]): PlaywrightCookie[] {
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

/**
 * Parse a JSON string of Cookie-Editor cookies.
 * Throws with a friendly message if the shape isn't right.
 */
export function parseCookieJson(raw: string): CookieEditorCookie[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw new Error("Invalid JSON file");
  }

  if (!Array.isArray(parsed)) {
    throw new Error(
      "Expected a JSON array of cookies (Cookie-Editor export format)"
    );
  }

  for (const c of parsed) {
    if (
      typeof c !== "object" ||
      c === null ||
      typeof (c as CookieEditorCookie).name !== "string" ||
      typeof (c as CookieEditorCookie).value !== "string" ||
      typeof (c as CookieEditorCookie).domain !== "string"
    ) {
      throw new Error(
        "Cookie entries must include string name, value, and domain"
      );
    }
  }

  return parsed as CookieEditorCookie[];
}

export interface ImportCookiesResult {
  vendorSlug: string;
  cookieCount: number;
  savedAt: string;
  expiresAt: string;
  sessionFilePath: string;
}

/**
 * Convert + persist cookies for one vendor slug. Overwrites an existing
 * session file if present.
 */
export async function importCookiesForVendor(
  vendorSlug: string,
  cookies: CookieEditorCookie[],
  days: number
): Promise<ImportCookiesResult> {
  const playwrightCookies = convertCookies(cookies);

  const sessionsDir = path.join(process.cwd(), "sessions");
  await fs.mkdir(sessionsDir, { recursive: true });

  const savedAt = new Date().toISOString();
  const expiresAt = new Date(
    Date.now() + days * 24 * 60 * 60 * 1000
  ).toISOString();

  const session = {
    vendorSlug,
    cookies: playwrightCookies,
    savedAt,
    expiresAt,
  };

  const dest = path.join(sessionsDir, `${vendorSlug}.session.json`);
  await fs.writeFile(dest, JSON.stringify(session, null, 2));

  return {
    vendorSlug,
    cookieCount: playwrightCookies.length,
    savedAt,
    expiresAt,
    sessionFilePath: dest,
  };
}
