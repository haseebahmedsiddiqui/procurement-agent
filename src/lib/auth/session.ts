import { SignJWT, jwtVerify } from "jose";

const COOKIE_NAME = "pa_session";
const SESSION_TTL = 60 * 60 * 24 * 7;

function getSecret(): Uint8Array {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error(
      "AUTH_SECRET is missing or too short (need 32+ chars). Set it in .env.local"
    );
  }
  return new TextEncoder().encode(secret);
}

export interface SessionPayload {
  email: string;
  iat?: number;
  exp?: number;
}

export async function createSessionToken(email: string): Promise<string> {
  return await new SignJWT({ email })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_TTL}s`)
    .sign(getSecret());
}

export async function verifySessionToken(
  token: string
): Promise<SessionPayload | null> {
  try {
    const { payload } = await jwtVerify(token, getSecret());
    if (typeof payload.email !== "string") return null;
    return { email: payload.email, iat: payload.iat, exp: payload.exp };
  } catch {
    return null;
  }
}

export const SESSION_COOKIE = COOKIE_NAME;
export const SESSION_MAX_AGE = SESSION_TTL;
