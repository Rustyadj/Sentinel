// Bearer-token auth for the Sentinel mobile app.
//
// NextAuth's session is a cookie the browser carries automatically; a React
// Native client has no cookie jar wired into its own request flow the same
// way, so it needs something it can hold onto and send as a header instead.
// Rather than reach into NextAuth's own JWE session-cookie format (coupled
// to its rotation and internals, and meant to be read via getToken() from a
// request that already carries the cookie), this issues a small, separate
// HS256 token — signed with the same AUTH_SECRET, verified only by
// verifyMobileToken below. No new dependency: HMAC-SHA256 and constant-time
// comparison are both node:crypto, and Buffer already speaks base64url.
import { createHmac, timingSafeEqual } from "node:crypto";

const ALG = "HS256";
const TOKEN_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days — re-login past that, no refresh flow yet.

export interface MobileTokenPayload {
  /** User id. */
  sub: string;
  email: string;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not configured");
  return value;
}

function signingInput(header: string, body: string): string {
  return `${header}.${body}`;
}

function sign(input: string): string {
  return createHmac("sha256", secret()).update(input).digest("base64url");
}

export function signMobileToken(payload: MobileTokenPayload): string {
  const header = Buffer.from(JSON.stringify({ alg: ALG, typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ sub: payload.sub, email: payload.email, iat: now, exp: now + TOKEN_TTL_SECONDS }),
  ).toString("base64url");
  const input = signingInput(header, body);
  return `${input}.${sign(input)}`;
}

/** Verifies signature, shape, and expiry. Returns null on any failure —
 * callers treat that as "no valid token," same as a missing header. */
export function verifyMobileToken(token: string): MobileTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  const expected = sign(signingInput(header, body));
  const provided = Buffer.from(signature);
  const known = Buffer.from(expected);
  // Mismatched lengths would make timingSafeEqual throw rather than just
  // return false — check that first instead of wrapping it in try/catch.
  if (provided.length !== known.length || !timingSafeEqual(provided, known)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<MobileTokenPayload> & {
      exp?: number;
    };
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { sub: payload.sub, email: payload.email };
  } catch {
    return null;
  }
}
