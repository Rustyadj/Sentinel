/** Hard dispatch boundary: default orchestration may select either coding
 * runtime, but never concurrently split one task across both. */
export const MUTUALLY_EXCLUSIVE_CONCURRENT = ["claude-code", "codex"] as const;

export function assertConcurrentDispatchAllowed(agentIds: readonly string[], explicitUserOverride = false): void {
  if (explicitUserOverride) return;
  if (MUTUALLY_EXCLUSIVE_CONCURRENT.every((id) => agentIds.includes(id))) {
    throw new Error("Claude Code and Codex cannot be concurrently dispatched for one task without explicit user override.");
  }
}
