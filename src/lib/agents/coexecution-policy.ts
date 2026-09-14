/** Hard dispatch boundary: default orchestration may select either coding
 * runtime, but never concurrently split one task across both. */
export const MUTUALLY_EXCLUSIVE_CONCURRENT = ["claude-code", "codex"] as const;

export function assertConcurrentDispatchAllowed(agentIds: readonly string[], explicitUserOverride = false): void {
  if (explicitUserOverride) return;
  if (MUTUALLY_EXCLUSIVE_CONCURRENT.every((id) => agentIds.includes(id))) {
    throw new Error("Claude Code and Codex cannot be concurrently dispatched for one task without explicit user override.");
  }
}

/** True when adding `candidate` to the already in-flight `active` set would put
 * both mutually exclusive coding runtimes in flight at the same time. Callers
 * resolve the concurrent set themselves; this stays pure so it is testable
 * against the exact sets production builds. */
export function wouldSplitAcrossCodingRuntimes(active: readonly string[], candidate: string): boolean {
  if (!MUTUALLY_EXCLUSIVE_CONCURRENT.includes(candidate as (typeof MUTUALLY_EXCLUSIVE_CONCURRENT)[number])) return false;
  const counterpart = MUTUALLY_EXCLUSIVE_CONCURRENT.find((id) => id !== candidate);
  return Boolean(counterpart && active.includes(counterpart));
}
