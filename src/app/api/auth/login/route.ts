import { NextRequest, NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { createSessionToken, SESSION_COOKIE, SESSION_MAX_AGE } from "@/lib/auth/session";
import { logger } from "@/lib/logger";

export async function POST(request: NextRequest) {
  try {
    const { email, password } = (await request.json()) as {
      email?: string;
      password?: string;
    };

    if (!email || !password) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const expectedEmail = process.env.AUTH_EMAIL;
    // AUTH_PASSWORD_HASH_B64 takes precedence — base64 has no `$`, so it
    // survives dotenv-expand cleanly. Falls back to AUTH_PASSWORD_HASH if set.
    const hashB64 = process.env.AUTH_PASSWORD_HASH_B64;
    const expectedHash = hashB64
      ? Buffer.from(hashB64, "base64").toString("utf8")
      : process.env.AUTH_PASSWORD_HASH;

    if (!expectedEmail || !expectedHash) {
      logger.error("AUTH_EMAIL or AUTH_PASSWORD_HASH(_B64) missing from env");
      return NextResponse.json(
        { error: "Server auth is not configured" },
        { status: 500 }
      );
    }

    if (email.trim().toLowerCase() !== expectedEmail.toLowerCase()) {
      await bcrypt.compare(password, expectedHash);
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const ok = await bcrypt.compare(password, expectedHash);
    if (!ok) {
      return NextResponse.json(
        { error: "Invalid email or password" },
        { status: 401 }
      );
    }

    const token = await createSessionToken(email.trim().toLowerCase());

    const response = NextResponse.json({ success: true, email: expectedEmail });
    response.cookies.set(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: "lax",
      // Default: secure in production. Set AUTH_COOKIE_SECURE=false when
      // running production builds over plain HTTP (e.g. behind a non-TLS
      // reverse proxy). Without this, browsers drop the cookie silently.
      secure:
        process.env.AUTH_COOKIE_SECURE === "false"
          ? false
          : process.env.NODE_ENV === "production",
      path: "/",
      maxAge: SESSION_MAX_AGE,
    });

    return response;
  } catch (err) {
    logger.error({ error: err }, "Login failed");
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Login failed" },
      { status: 500 }
    );
  }
}
