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
const DEFAULT_TTL_SECONDS = 60 * 60 * 24 * 7; // 7 days — re-login past that, no refresh flow yet.
const MAX_TTL_SECONDS = 60 * 60 * 24 * 30;

/** MOBILE_TOKEN_TTL_SECONDS overrides the lifetime, capped at 30 days. */
export function mobileTokenTtlSeconds(): number {
  const configured = Number(process.env.MOBILE_TOKEN_TTL_SECONDS);
  return Number.isInteger(configured) && configured > 0 ? Math.min(configured, MAX_TTL_SECONDS) : DEFAULT_TTL_SECONDS;
}

export interface MobileTokenPayload {
  /** User id. */
  sub: string;
  email: string;
}

export interface VerifiedMobileToken extends MobileTokenPayload {
  /** Issued-at, seconds since epoch. Compared against User.mobileTokensRevokedAt. */
  iat: number;
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
    JSON.stringify({ sub: payload.sub, email: payload.email, iat: now, exp: now + mobileTokenTtlSeconds() }),
  ).toString("base64url");
  const input = signingInput(header, body);
  return `${input}.${sign(input)}`;
}

/** Verifies signature, shape, and expiry. Returns null on any failure —
 * callers treat that as "no valid token," same as a missing header.
 * Revocation is checked by the caller against the user row (see
 * isMobileTokenRevoked), which requireApiUser already loads. */
export function verifyMobileToken(token: string): VerifiedMobileToken | null {
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
      iat?: number;
    };
    // Every token this module signs carries exp and iat; one without them was
    // not minted here and must not be accepted as non-expiring.
    if (typeof payload.exp !== "number" || typeof payload.iat !== "number") return null;
    if (payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.sub !== "string" || typeof payload.email !== "string") return null;
    return { sub: payload.sub, email: payload.email, iat: payload.iat };
  } catch {
    return null;
  }
}

/**
 * True when the user revoked their mobile sessions at or after this token was
 * issued. iat has one-second resolution, so a token minted in the same second
 * as the revocation is treated as revoked (re-login, rather than a token that
 * slips past a revocation).
 */
export function isMobileTokenRevoked(token: VerifiedMobileToken, revokedAt: Date | null): boolean {
  return revokedAt !== null && token.iat * 1000 <= revokedAt.getTime();
}
