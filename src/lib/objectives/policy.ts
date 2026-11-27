import { ALWAYS_GATED_IMPACTS, type AutonomyLevel, type StepImpact, type StepKind } from "./types";

/**
 * The autonomy policy: given an objective's level and one step about to run,
 * decide whether it runs now, needs a human first, or is only recommended.
 *
 * Pure and table-driven so the whole matrix is unit-testable.
 *
 *  Level 1 Advisory    reads run; everything else is recorded as advice, never executed.
 *  Level 2 Supervised  reads run; every other step needs an approval.
 *  Level 3 Managed     reads and writes run; publishing and agent delegation need approval.
 *  Level 4 Delegated   reads, writes, publishing and delegation run.
 *
 * At every level, financial / legal / destructive / credential steps need an
 * approval, and so does any step that would take spend past the budget.
 */
/**
 * Why a step needs a human. Standing delegation (src/lib/autonomy/) may clear
 * `always_gated`, `managed_publish` and `managed_delegate` when a grant
 * covers the operation, and `supervised` only with a grant scoped to this
 * exact objective (the operator chose per-action review for it). `budget`
 * is never cleared by a grant: the objective's own budget is an explicit
 * user boundary.
 */
export type ApprovalReasonCode = "always_gated" | "budget" | "supervised" | "managed_publish" | "managed_delegate";

export type PolicyDecision =
  | { action: "execute" }
  | { action: "approve"; reason: string; code: ApprovalReasonCode }
  | { action: "advise"; reason: string };

export interface PolicyInput {
  level: AutonomyLevel;
  kind: StepKind;
  impact: StepImpact;
  estimatedCostCents: number;
  spentCents: number;
  budgetCents: number;
}

export function decideStep(input: PolicyInput): PolicyDecision {
  const { level, kind, impact } = input;
  if (impact === "read") return { action: "execute" };
  if (level === 1) return { action: "advise", reason: `Advisory mode: ${impact} actions are recommended, not executed.` };
  if (ALWAYS_GATED_IMPACTS.includes(impact)) {
    return { action: "approve", code: "always_gated", reason: `${impact} actions require explicit human authorization (a standing grant naming "${impact}" counts).` };
  }
  if (input.estimatedCostCents > 0 && input.spentCents + input.estimatedCostCents > input.budgetCents) {
    return { action: "approve", code: "budget", reason: `Estimated cost ${input.estimatedCostCents}¢ would exceed the remaining budget (${Math.max(0, input.budgetCents - input.spentCents)}¢).` };
  }
  if (level === 2) return { action: "approve", code: "supervised", reason: "Supervised mode: each action is approved individually." };
  if (level === 3 && (impact === "publish" || kind === "agent")) {
    return impact === "publish"
      ? { action: "approve", code: "managed_publish", reason: "Managed mode: publishing externally requires approval or a standing grant naming \"publish\"." }
      : { action: "approve", code: "managed_delegate", reason: "Managed mode: delegating to another agent requires approval or a standing grant covering \"delegate\"." };
  }
  return { action: "execute" };
}

/**
 * Automatic recovery budget. A failed attempt does not end a step: every
 * executing level retries (each attempt reuses the step's idempotency key, so
 * a retried side effect is not repeated) up to the step's own limit and the
 * configured recovery budget (AutonomySettings.maxRecoveryAttempts). Advisory
 * mode never executes, so it never retries.
 */
export const DEFAULT_RECOVERY_ATTEMPTS = 4;

export function allowedAttempts(level: AutonomyLevel, stepMaxAttempts: number, recoveryAttempts = DEFAULT_RECOVERY_ATTEMPTS): number {
  if (level === 1) return 1;
  return Math.max(1, Math.min(Math.max(1, stepMaxAttempts), Math.max(0, recoveryAttempts) + 1));
}

/** Default level for objectives created without one: Managed — reads and writes run, consequential actions follow authority. */
export const DEFAULT_AUTONOMY_LEVEL: AutonomyLevel = 3;

/** Exponential backoff with a ceiling: 30s, 60s, 120s ... capped at 15 minutes. */
export function retryDelayMs(attempt: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export function parseAutonomyLevel(value: unknown): AutonomyLevel | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}
