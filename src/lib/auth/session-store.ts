import fs from "fs/promises";
import path from "path";
import type { Cookie } from "playwright";
import { logger } from "@/lib/logger";

const SESSIONS_DIR = path.join(process.cwd(), "sessions");

export interface StoredSession {
  vendorSlug: string;
  cookies: Cookie[];
  savedAt: string; // ISO date
  expiresAt: string; // ISO date
}

async function ensureSessionsDir(): Promise<void> {
  await fs.mkdir(SESSIONS_DIR, { recursive: true });
}

function sessionPath(vendorSlug: string): string {
  return path.join(SESSIONS_DIR, `${vendorSlug}.session.json`);
}

export async function saveSession(
  vendorSlug: string,
  cookies: Cookie[],
  maxAgeHours: number
): Promise<void> {
  await ensureSessionsDir();

  const session: StoredSession = {
    vendorSlug,
    cookies,
    savedAt: new Date().toISOString(),
    expiresAt: new Date(
      Date.now() + maxAgeHours * 60 * 60 * 1000
    ).toISOString(),
  };

  await fs.writeFile(sessionPath(vendorSlug), JSON.stringify(session, null, 2));
  logger.info(
    { vendor: vendorSlug, expiresAt: session.expiresAt },
    "Session saved"
  );
}

export async function loadSession(
  vendorSlug: string
): Promise<StoredSession | null> {
  try {
    const data = await fs.readFile(sessionPath(vendorSlug), "utf-8");
    const session: StoredSession = JSON.parse(data);
    return session;
  } catch {
    return null;
  }
}

export async function validateSession(
  vendorSlug: string
): Promise<{ valid: boolean; session: StoredSession | null; reason?: string }> {
  const session = await loadSession(vendorSlug);

  if (!session) {
    return { valid: false, session: null, reason: "no_session" };
  }

  const now = new Date();
  const expiresAt = new Date(session.expiresAt);

  if (now >= expiresAt) {
    return { valid: false, session, reason: "expired" };
  }

  if (!session.cookies.length) {
    return { valid: false, session, reason: "no_cookies" };
  }

  return { valid: true, session };
}

export async function deleteSession(vendorSlug: string): Promise<void> {
  try {
    await fs.unlink(sessionPath(vendorSlug));
    logger.info({ vendor: vendorSlug }, "Session deleted");
  } catch {
    // File doesn't exist, that's fine
  }
}

export async function getAllSessionStatuses(): Promise<
  Record<string, { valid: boolean; savedAt?: string; expiresAt?: string; reason?: string }>
> {
  await ensureSessionsDir();

  const files = await fs.readdir(SESSIONS_DIR);
  const statuses: Record<
    string,
    { valid: boolean; savedAt?: string; expiresAt?: string; reason?: string }
  > = {};

  for (const file of files) {
    if (!file.endsWith(".session.json")) continue;
    const slug = file.replace(".session.json", "");
    const result = await validateSession(slug);
    statuses[slug] = {
      valid: result.valid,
      savedAt: result.session?.savedAt,
      expiresAt: result.session?.expiresAt,
      reason: result.reason,
    };
  }

  return statuses;
}
