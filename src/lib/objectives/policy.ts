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
export type PolicyDecision =
  | { action: "execute" }
  | { action: "approve"; reason: string }
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
    return { action: "approve", reason: `${impact} actions always require explicit human authorization.` };
  }
  if (input.estimatedCostCents > 0 && input.spentCents + input.estimatedCostCents > input.budgetCents) {
    return { action: "approve", reason: `Estimated cost ${input.estimatedCostCents}¢ would exceed the remaining budget (${Math.max(0, input.budgetCents - input.spentCents)}¢).` };
  }
  if (level === 2) return { action: "approve", reason: "Supervised mode: each action is approved individually." };
  if (level === 3 && (impact === "publish" || kind === "agent")) {
    return { action: "approve", reason: impact === "publish" ? "Managed mode: publishing externally requires approval." : "Managed mode: delegating to another agent requires approval." };
  }
  return { action: "execute" };
}

/** Automatic retries: managed mode retries once, delegated mode up to the step's limit. */
export function allowedAttempts(level: AutonomyLevel, stepMaxAttempts: number): number {
  if (level >= 4) return Math.max(1, stepMaxAttempts);
  if (level === 3) return Math.min(2, Math.max(1, stepMaxAttempts));
  return 1;
}

/** Exponential backoff with a ceiling: 30s, 60s, 120s ... capped at 15 minutes. */
export function retryDelayMs(attempt: number): number {
  return Math.min(15 * 60_000, 30_000 * 2 ** Math.max(0, attempt - 1));
}

export function parseAutonomyLevel(value: unknown): AutonomyLevel | null {
  return value === 1 || value === 2 || value === 3 || value === 4 ? value : null;
}
