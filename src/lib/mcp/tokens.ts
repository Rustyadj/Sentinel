/**
 * Access tokens for the MCP gateway.
 *
 * Same reasoning as mobile-auth.ts: rather than couple to NextAuth's session
 * cookie format, this signs a small HS256 token with AUTH_SECRET using only
 * node:crypto. The token is stateless except for one thing — it carries the
 * grant id, and the gateway loads that grant on every request. That keeps
 * revocation immediate (revoke the grant, every outstanding token dies) while
 * the scopes, user and workspace still travel in the token itself and are
 * verified against the grant, so a stale token can never widen its own scope.
 *
 * Refresh tokens are opaque random strings; only their SHA-256 lives in the
 * database, so a leaked row is not redeemable.
 */
import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

export const ACCESS_TOKEN_TTL_SECONDS = 60 * 60; // 1 hour — refresh handles longevity.
export const REFRESH_TOKEN_TTL_SECONDS = 60 * 60 * 24 * 60; // 60 days
export const AUTH_CODE_TTL_SECONDS = 60; // RFC 6749 §4.1.2 recommends <= 10 min; MCP flows redeem in seconds.

export interface McpAccessTokenPayload {
  /** Sentinel user id the connector acts for. */
  sub: string;
  /** McpGrant.id — the revocation handle. */
  gid: string;
  /** OAuth client id. */
  cid: string;
  /** RFC 8707 audience: the one MCP resource this token may call. */
  aud: string;
  scopes: string[];
  /** Tenant workspace the grant is bound to, when the human picked one. */
  wsid?: string | null;
}

function secret(): string {
  const value = process.env.AUTH_SECRET;
  if (!value) throw new Error("AUTH_SECRET is not configured");
  return value;
}

function sign(input: string): string {
  return createHmac("sha256", secret()).update(input).digest("base64url");
}

export function signAccessToken(payload: McpAccessTokenPayload, ttlSeconds = ACCESS_TOKEN_TTL_SECONDS): string {
  const header = Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url");
  const now = Math.floor(Date.now() / 1000);
  const body = Buffer.from(
    JSON.stringify({ ...payload, iat: now, exp: now + ttlSeconds }),
  ).toString("base64url");
  const input = `${header}.${body}`;
  return `${input}.${sign(input)}`;
}

/** Verifies signature, shape and expiry. Null on any failure — never throws. */
export function verifyAccessToken(token: string, expectedAudience?: string): McpAccessTokenPayload | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  const [header, body, signature] = parts;

  const expected = sign(`${header}.${body}`);
  const provided = Buffer.from(signature);
  const known = Buffer.from(expected);
  // timingSafeEqual throws on a length mismatch rather than returning false.
  if (provided.length !== known.length || !timingSafeEqual(provided, known)) return null;

  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<McpAccessTokenPayload> & {
      exp?: number;
    };
    if (typeof payload.exp === "number" && payload.exp < Math.floor(Date.now() / 1000)) return null;
    if (typeof payload.sub !== "string" || typeof payload.gid !== "string" || typeof payload.cid !== "string" || typeof payload.aud !== "string") {
      return null;
    }
    if (expectedAudience && payload.aud !== expectedAudience) return null;
    if (!Array.isArray(payload.scopes) || payload.scopes.some((scope) => typeof scope !== "string")) return null;
    return {
      sub: payload.sub,
      gid: payload.gid,
      cid: payload.cid,
      aud: payload.aud,
      scopes: payload.scopes,
      wsid: typeof payload.wsid === "string" ? payload.wsid : null,
    };
  } catch {
    return null;
  }
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** RFC 7636 S256: BASE64URL(SHA256(ASCII(verifier))). */
export function s256Challenge(verifier: string): string {
  return createHash("sha256").update(verifier, "ascii").digest("base64url");
}

export function verifyPkce(verifier: string, challenge: string, method: string): boolean {
  // "plain" is deliberately unsupported: OAuth 2.1 removed it, and every MCP
  // client in the wild sends S256.
  if (method !== "S256") return false;
  const computed = Buffer.from(s256Challenge(verifier));
  const stored = Buffer.from(challenge);
  if (computed.length !== stored.length) return false;
  return timingSafeEqual(computed, stored);
}
