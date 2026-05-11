import { NextRequest, NextResponse } from "next/server";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { runImport } from "@/lib/inventory/importer";
import { verifySessionToken, SESSION_COOKIE } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

export const runtime = "nodejs";
export const maxDuration = 120;

const MAX_FILES = 4;
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20 MB — leaves headroom over the 1.6 MB sample

/**
 * POST /api/inventory/import
 *
 * Accepts up to four PDF files via multipart form (`files`). Writes them to
 * a temp directory, then invokes the importer. The temp files are always
 * cleaned up, including on error.
 */
export async function POST(request: NextRequest) {
  let tempDir: string | null = null;

  try {
    const token = request.cookies.get(SESSION_COOKIE)?.value;
    const session = token ? await verifySessionToken(token) : null;

    const form = await request.formData();
    const fileEntries = form.getAll("files");
    const dryRun = form.get("dryRun") === "true";

    if (fileEntries.length === 0) {
      return NextResponse.json({ error: "No files uploaded" }, { status: 400 });
    }
    if (fileEntries.length > MAX_FILES) {
      return NextResponse.json(
        { error: `Too many files (max ${MAX_FILES})` },
        { status: 400 }
      );
    }

    tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "inv-import-"));
    const filePaths: { path: string }[] = [];

    for (const entry of fileEntries) {
      if (!(entry instanceof File)) {
        return NextResponse.json(
          { error: "Invalid file in upload" },
          { status: 400 }
        );
      }
      if (!entry.name.toLowerCase().endsWith(".pdf")) {
        return NextResponse.json(
          { error: `Only PDF files are accepted (${entry.name})` },
          { status: 400 }
        );
      }
      if (entry.size > MAX_FILE_SIZE) {
        return NextResponse.json(
          { error: `${entry.name} exceeds ${MAX_FILE_SIZE / 1024 / 1024} MB` },
          { status: 400 }
        );
      }

      const buf = Buffer.from(await entry.arrayBuffer());
      const safeName = entry.name.replace(/[^A-Za-z0-9._-]/g, "_");
      const dest = path.join(
        tempDir,
        `${crypto.randomUUID()}_${safeName}`
      );
      await fs.writeFile(dest, buf);
      filePaths.push({ path: dest });
    }

    const summary = await runImport(filePaths, {
      importedBy: session?.email ?? null,
      dryRun,
    });

    return NextResponse.json({ ok: true, summary });
  } catch (err) {
    logger.error({ err }, "Inventory import API failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Import failed" },
      { status: 500 }
    );
  } finally {
    if (tempDir) {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
  }
}
