// Sentinel — when a memory must not be trusted without checking.
//
// Retrieval returns what was recorded. For a stable fact that is the same as
// returning what is true; for a volatile one it is not, and nothing previously
// distinguished the two. A nine-month-old "the gateway is healthy" was
// retrieved with exactly the standing of an architectural decision.
//
// This does not remove volatile memories — knowing that a price was X in March
// is genuinely useful, and a memory system that discards everything perishable
// cannot answer a historical question. It marks them, so a caller that can
// reach the authoritative source checks it rather than trusting the memory,
// and one that cannot at least knows the answer may have moved.

export type Volatility = "stable" | "slow" | "volatile";
export type VerificationPolicy = "none" | "on_read" | "periodic";

/** How long a memory of each kind stays trustworthy without re-checking. */
export const FRESHNESS_WINDOW_MS: Record<Volatility, number> = {
  // Effectively never goes stale on its own; supersession is what retires it.
  stable: Number.POSITIVE_INFINITY,
  // Weeks: team processes, ownership, conventions.
  slow: 30 * 24 * 60 * 60 * 1000,
  // Minutes: service status, availability, live deployment state.
  volatile: 15 * 60 * 1000,
};

export interface VerifiableMemory {
  volatility?: string | null;
  verificationPolicy?: string | null;
  lastVerifiedAt?: Date | null;
  authoritativeSource?: string | null;
  createdAt: Date;
}

export interface VerificationNeed {
  required: boolean;
  /** Why, in a form that can be shown to an agent alongside the memory. */
  reason: string | null;
  authoritativeSource: string | null;
  ageMs: number;
}

function volatilityOf(memory: VerifiableMemory): Volatility {
  const value = memory.volatility ?? "stable";
  return value === "volatile" || value === "slow" ? value : "stable";
}

/**
 * Whether this memory should be checked against its source before being acted
 * on.
 *
 * Measured from `lastVerifiedAt` when there is one and `createdAt` otherwise:
 * a memory that has never been verified is exactly as old as the observation
 * that produced it.
 *
 * `on_read` always requires verification regardless of age, because the point
 * of that policy is facts where even a minute is too long.
 */
export function verificationNeed(memory: VerifiableMemory, now: number = Date.now()): VerificationNeed {
  const volatility = volatilityOf(memory);
  const policy = (memory.verificationPolicy ?? "none") as VerificationPolicy;
  const since = memory.lastVerifiedAt ?? memory.createdAt;
  const ageMs = Math.max(0, now - since.getTime());
  const source = memory.authoritativeSource ?? null;

  if (policy === "on_read") {
    return { required: true, reason: "policy requires checking the authoritative source on every read", authoritativeSource: source, ageMs };
  }

  const window = FRESHNESS_WINDOW_MS[volatility];
  if (Number.isFinite(window) && ageMs > window) {
    const days = Math.floor(ageMs / 86_400_000);
    const age = days >= 1 ? `${days}d` : `${Math.floor(ageMs / 60_000)}m`;
    return {
      required: true,
      reason: `${volatility} fact, unverified for ${age}; it may no longer be current`,
      authoritativeSource: source,
      ageMs,
    };
  }

  return { required: false, reason: null, authoritativeSource: source, ageMs };
}

/** A short marker to render beside the memory in an assembled prompt. */
export function verificationNotice(need: VerificationNeed): string | null {
  if (!need.required) return null;
  return need.authoritativeSource
    ? `[needs verification: ${need.reason} — check ${need.authoritativeSource}]`
    : `[needs verification: ${need.reason}]`;
}
