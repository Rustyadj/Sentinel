/**
 * Telnyx runtime configuration, read from the environment on every call so
 * tests and rotated secrets never see a stale module-level snapshot.
 *
 * The API key, webhook public key and media-token secret are credentials: they
 * come from the environment only and must never be committed or logged.
 */
export interface TelnyxConfig {
  apiKey: string;
  /** Base64 Ed25519 public key from the Telnyx portal (Account > Keys & Credentials > Public Key). */
  publicKey: string;
  /** E.164 number SMS and calls are sent from. */
  fromNumber: string;
  /** Sentinel user the phone line belongs to; inbound traffic and trusted callers act as this user. */
  ownerUserId: string;
  /** Default agent for inbound calls and texts. */
  agentId: string;
  /** Per-called-number agent overrides: { "+1555…": "hermes-lisa" }. */
  numberRoutes: Readonly<Record<string, string>>;
  /** E.164 numbers whose calls/texts are trusted with the agent's full runtime. */
  trustedNumbers: ReadonlySet<string>;
  /** What happens to an unknown inbound caller: take a message, or hang up. */
  unknownCallers: "message" | "reject";
  apiBase: string;

  /** Call Control application id; required to place or answer calls with media streaming. */
  connectionId: string | null;
  /** Public wss:// URL of the media bridge, as Telnyx reaches it. */
  mediaWsUrl: string | null;
  /** HMAC secret authenticating Telnyx's connection to the media bridge. */
  mediaTokenSecret: string | null;

  maxConcurrentCalls: number;
  maxCallSeconds: number;
  outboundCallsPerHour: number;
  /** Dialing country codes permitted for outbound calls (digits, no +). */
  allowedCountryCodes: ReadonlySet<string>;
}

export class TelnyxConfigError extends Error {}

const DEFAULT_API_BASE = "https://api.telnyx.com/v2";
export const DEFAULT_INBOUND_AGENT = "hermes-lisa";

export function normalizeE164(value: string): string {
  const digits = value.replace(/[^\d+]/g, "");
  return digits.startsWith("+") ? digits : `+${digits}`;
}

export function isE164(value: string): boolean {
  return /^\+[1-9]\d{6,14}$/.test(value);
}

function parseList(raw: string | undefined): string[] {
  return (raw ?? "").split(",").map((v) => v.trim()).filter(Boolean);
}

function positiveInt(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isInteger(n) && n > 0 ? n : fallback;
}

function parseRoutes(raw: string | undefined): Record<string, string> {
  if (!raw?.trim()) return {};
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    return Object.fromEntries(
      Object.entries(parsed)
        .filter((entry): entry is [string, string] => typeof entry[1] === "string")
        .map(([number, agent]) => [normalizeE164(number), agent]),
    );
  } catch {
    throw new TelnyxConfigError("TELNYX_NUMBER_ROUTES must be a JSON object of number to agent id");
  }
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

  const secret = env.TELNYX_MEDIA_TOKEN_SECRET?.trim() || null;
  if (secret && secret.length < 32) throw new TelnyxConfigError("TELNYX_MEDIA_TOKEN_SECRET must be at least 32 characters");

  return {
    apiKey: required.TELNYX_API_KEY!.trim(),
    publicKey: required.TELNYX_PUBLIC_KEY!.trim(),
    fromNumber: normalizeE164(required.TELNYX_FROM_NUMBER!),
    ownerUserId: required.TELNYX_OWNER_USER_ID!.trim(),
    agentId: env.TELNYX_AGENT_ID?.trim() || DEFAULT_INBOUND_AGENT,
    numberRoutes: parseRoutes(env.TELNYX_NUMBER_ROUTES),
    trustedNumbers: new Set(parseList(env.TELNYX_ALLOWED_NUMBERS).map(normalizeE164)),
    unknownCallers: env.TELNYX_UNKNOWN_CALLERS === "reject" ? "reject" : "message",
    apiBase: env.TELNYX_API_BASE?.trim() || DEFAULT_API_BASE,
    connectionId: env.TELNYX_CONNECTION_ID?.trim() || null,
    mediaWsUrl: env.TELNYX_MEDIA_WS_URL?.trim() || null,
    mediaTokenSecret: secret,
    maxConcurrentCalls: positiveInt(env.TELNYX_MAX_CONCURRENT_CALLS, 4),
    maxCallSeconds: positiveInt(env.TELNYX_MAX_CALL_SECONDS, 1_800),
    outboundCallsPerHour: positiveInt(env.TELNYX_OUTBOUND_CALLS_PER_HOUR, 20),
    allowedCountryCodes: new Set(parseList(env.TELNYX_ALLOWED_COUNTRY_CODES || "1")),
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

export function isTrustedNumber(config: TelnyxConfig, number: string | undefined): boolean {
  return Boolean(number) && config.trustedNumbers.has(normalizeE164(number!));
}

/** Calling needs more than texting; report exactly what is missing instead of failing mid-dial. */
export function requireCallingConfig(config: TelnyxConfig): asserts config is TelnyxConfig & {
  connectionId: string;
  mediaWsUrl: string;
  mediaTokenSecret: string;
} {
  const missing = [
    !config.connectionId && "TELNYX_CONNECTION_ID",
    !config.mediaWsUrl && "TELNYX_MEDIA_WS_URL",
    !config.mediaTokenSecret && "TELNYX_MEDIA_TOKEN_SECRET",
  ].filter(Boolean);
  if (missing.length > 0) throw new TelnyxConfigError(`Voice calling is not configured: missing ${missing.join(", ")}`);
  if (!config.mediaWsUrl!.startsWith("wss://")) throw new TelnyxConfigError("TELNYX_MEDIA_WS_URL must be a wss:// URL");
}
