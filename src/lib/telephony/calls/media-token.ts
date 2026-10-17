import { createHmac, timingSafeEqual } from "node:crypto";

/**
 * Telnyx connects to the media bridge without any Sentinel credential, so the
 * stream URL itself carries a short-lived HMAC bound to one call id. Without
 * it, anyone who found the bridge URL could open a live agent session.
 */
const TOKEN_TTL_SECONDS = 120;

const sign = (secret: string, callId: string, exp: number) =>
  createHmac("sha256", secret).update(`${callId}.${exp}`).digest("base64url");

export function issueMediaToken(secret: string, callId: string, nowMs = Date.now()): string {
  const exp = Math.floor(nowMs / 1000) + TOKEN_TTL_SECONDS;
  return `${callId}.${exp}.${sign(secret, callId, exp)}`;
}

/** Returns the call id when the token is authentic and unexpired. */
export function verifyMediaToken(secret: string, token: string | null | undefined, nowMs = Date.now()): string | null {
  if (!token) return null;
  const [callId, expRaw, mac] = token.split(".");
  const exp = Number(expRaw);
  if (!callId || !mac || !Number.isInteger(exp) || exp < Math.floor(nowMs / 1000)) return null;
  const expected = Buffer.from(sign(secret, callId, exp));
  const given = Buffer.from(mac);
  return given.length === expected.length && timingSafeEqual(given, expected) ? callId : null;
}

export function mediaStreamUrl(baseWssUrl: string, secret: string, callId: string): string {
  const url = new URL(baseWssUrl);
  url.searchParams.set("t", issueMediaToken(secret, callId));
  return url.toString();
}
