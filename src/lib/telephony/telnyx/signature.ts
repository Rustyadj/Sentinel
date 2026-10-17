import { createPublicKey, verify } from "node:crypto";

/** Telnyx signs `${timestamp}|${rawBody}` with Ed25519; reject anything older than this. */
export const MAX_WEBHOOK_AGE_SECONDS = 300;

// SPKI prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI_PREFIX = Buffer.from("302a300506032b6570032100", "hex");

export type SignatureResult = { ok: true } | { ok: false; reason: string };

export function verifyTelnyxSignature(input: {
  rawBody: string;
  signature: string | null;
  timestamp: string | null;
  publicKey: string;
  nowMs?: number;
}): SignatureResult {
  const { rawBody, signature, timestamp, publicKey } = input;
  if (!signature || !timestamp) return { ok: false, reason: "missing signature headers" };

  const ts = Number(timestamp);
  if (!Number.isFinite(ts)) return { ok: false, reason: "invalid timestamp" };
  const ageSeconds = Math.abs((input.nowMs ?? Date.now()) / 1000 - ts);
  if (ageSeconds > MAX_WEBHOOK_AGE_SECONDS) return { ok: false, reason: "timestamp outside tolerance" };

  try {
    const rawKey = Buffer.from(publicKey, "base64");
    if (rawKey.length !== 32) return { ok: false, reason: "public key is not a 32-byte Ed25519 key" };
    const key = createPublicKey({ key: Buffer.concat([ED25519_SPKI_PREFIX, rawKey]), format: "der", type: "spki" });
    const valid = verify(null, Buffer.from(`${timestamp}|${rawBody}`), key, Buffer.from(signature, "base64"));
    return valid ? { ok: true } : { ok: false, reason: "signature mismatch" };
  } catch {
    return { ok: false, reason: "signature verification failed" };
  }
}
