/**
 * Telnyx runtime configuration, read from the environment on every call so
 * tests and rotated secrets never see a stale module-level snapshot.
 *
 * The API key and webhook public key are credentials: they come from the
 * environment only and must never be committed or logged.
 */
export interface TelnyxConfig {
  apiKey: string;
  /** Base64 Ed25519 public key from the Telnyx portal (Account > Keys & Credentials > Public Key). */
  publicKey: string;
  /** E.164 number SMS and call replies are sent from. */
  fromNumber: string;
  /** Sentinel user the phone channel acts as; runtime access and audit are scoped to this user. */
  ownerUserId: string;
  /** Agent that answers calls and texts. Must have a runtime configured. */
  agentId: string;
  /** E.164 callers permitted to reach the agent. Empty means nobody: fail closed. */
  allowedNumbers: ReadonlySet<string>;
  apiBase: string;
}

export class TelnyxConfigError extends Error {}

const DEFAULT_AGENT = "hermes-nathan2";
const DEFAULT_API_BASE = "https://api.telnyx.com/v2";

export function normalizeE164(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function loadTelnyxConfig(env: NodeJS.ProcessEnv = process.env): TelnyxConfig {
  const required = {
    TELNYX_API_KEY: env.TELNYX_API_KEY,
    TELNYX_PUBLIC_KEY: env.TELNYX_PUBLIC_KEY,
    TELNYX_FROM_NUMBER: env.TELNYX_FROM_NUMBER,
    TELNYX_OWNER_USER_ID: env.TELNYX_OWNER_USER_ID,
  };
  const missing = Object.entries(required).filter(([, v]) => !v?.trim()).map(([k]) => k);
  if (missing.length > 0) throw new TelnyxConfigError(`Telnyx is not configured: missing ${missing.join(", ")}`);

  const allowed = (env.TELNYX_ALLOWED_NUMBERS ?? "")
    .split(",")
    .map((n) => n.trim())
    .filter(Boolean)
    .map(normalizeE164);

  return {
    apiKey: required.TELNYX_API_KEY!.trim(),
    publicKey: required.TELNYX_PUBLIC_KEY!.trim(),
    fromNumber: normalizeE164(required.TELNYX_FROM_NUMBER!),
    ownerUserId: required.TELNYX_OWNER_USER_ID!.trim(),
    agentId: env.TELNYX_AGENT_ID?.trim() || DEFAULT_AGENT,
    allowedNumbers: new Set(allowed),
    apiBase: env.TELNYX_API_BASE?.trim() || DEFAULT_API_BASE,
  };
}

export function isTelnyxConfigured(env: NodeJS.ProcessEnv = process.env): boolean {
  try {
    loadTelnyxConfig(env);
    return true;
  } catch {
    return false;
  }
}

export function isAllowedCaller(config: TelnyxConfig, number: string | undefined): boolean {
  return Boolean(number) && config.allowedNumbers.has(normalizeE164(number!));
}
