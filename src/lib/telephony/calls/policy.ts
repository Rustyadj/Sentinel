import { redisIncrementWithExpiry } from "@/lib/redis";
import { isE164, type TelnyxConfig } from "../telnyx/config";

export class CallPolicyError extends Error {
  constructor(message: string, readonly code: "invalid_number" | "destination_blocked" | "rate_limited" | "busy" | "duplicate" | "unavailable") {
    super(message);
  }
}

/** Premium-rate and emergency destinations are never dialed by an agent, whatever the country allowlist says. */
const BLOCKED_PREFIXES = ["+1900", "+1976", "+1911", "+1988", "+44909", "+44908", "+449"];
const EMERGENCY = new Set(["+911", "+112", "+999"]);

/** Longest-match country code lookup against the configured allowlist (1–3 digit codes). */
export function countryCodeAllowed(config: TelnyxConfig, e164: string): boolean {
  const digits = e164.slice(1);
  return [1, 2, 3].some((len) => config.allowedCountryCodes.has(digits.slice(0, len)));
}

export function assertDialable(config: TelnyxConfig, number: string): void {
  if (!isE164(number)) throw new CallPolicyError("The destination is not a valid E.164 phone number.", "invalid_number");
  if (EMERGENCY.has(number) || BLOCKED_PREFIXES.some((p) => number.startsWith(p))) {
    throw new CallPolicyError("That destination is blocked by calling policy.", "destination_blocked");
  }
  if (!countryCodeAllowed(config, number)) {
    throw new CallPolicyError("Calls to that country are not enabled for this line.", "destination_blocked");
  }
  if (number === config.fromNumber) throw new CallPolicyError("Refusing to call the line's own number.", "destination_blocked");
}

/** Fixed-window per-user cap. Fails closed: with no Redis there is no rate limiter, so no outbound dialing. */
export async function enforceOutboundRateLimit(config: TelnyxConfig, userId: string): Promise<void> {
  const windowSeconds = 3_600;
  const window = Math.floor(Date.now() / (windowSeconds * 1_000));
  const count = await redisIncrementWithExpiry(`telnyx:dial:${userId}:${window}`, windowSeconds + 1);
  if (count === null) throw new CallPolicyError("Calling is temporarily unavailable.", "unavailable");
  if (count > config.outboundCallsPerHour) {
    throw new CallPolicyError(`Outbound call limit reached (${config.outboundCallsPerHour}/hour).`, "rate_limited");
  }
}
