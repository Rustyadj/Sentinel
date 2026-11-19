/**
 * Shared vocabulary for autonomous objectives. See docs/OBJECTIVES.md.
 *
 * Kept free of Prisma and Node imports so client components can import it.
 */

export const AUTONOMY_LEVELS = [1, 2, 3, 4] as const;
export type AutonomyLevel = (typeof AUTONOMY_LEVELS)[number];

export const AUTONOMY_LABELS: Record<AutonomyLevel, string> = {
  1: "Advisory",
  2: "Supervised",
  3: "Managed autonomy",
  4: "Delegated autonomy",
};

/**
 * What a step does to the world. Ordered from harmless to most consequential.
 * `financial`, `legal`, `destructive` and `credential` always need a human,
 * at every autonomy level.
 */
export const STEP_IMPACTS = ["read", "write", "publish", "financial", "legal", "destructive", "credential"] as const;
export type StepImpact = (typeof STEP_IMPACTS)[number];

export const ALWAYS_GATED_IMPACTS: readonly StepImpact[] = ["financial", "legal", "destructive", "credential"];

export type StepKind = "tool" | "agent" | "verify";

export const STEP_STATUSES = [
  "pending", "running", "waiting_approval", "retry_wait", "blocked", "advised", "completed", "failed", "cancelled",
] as const;
export type StepStatus = (typeof STEP_STATUSES)[number];

/** A step in one of these will not change again without a human (retry/resume). */
export const SETTLED_STEP_STATUSES: readonly StepStatus[] = ["blocked", "advised", "completed", "failed", "cancelled"];

export const OBJECTIVE_STATUSES = [
  "running", "paused", "waiting_approval", "blocked", "completed", "failed", "stopped",
] as const;
export type ObjectiveStatus = (typeof OBJECTIVE_STATUSES)[number];

/** Objectives the engine still advances on its own. */
export const ACTIVE_OBJECTIVE_STATUSES: readonly ObjectiveStatus[] = ["running", "waiting_approval"];

export const OBJECTIVE_APPROVAL_TYPE = "objective_step";

export interface PlannedStep {
  key: string;
  title: string;
  role: string;
  kind: StepKind;
  toolKey: string;
  input: Record<string, unknown>;
  dependsOn: string[];
  impact: StepImpact;
  estimatedCostCents?: number;
  maxAttempts?: number;
}

export interface ObjectivePlan {
  templateKey: string;
  title: string;
  inputs: Record<string, unknown>;
  steps: PlannedStep[];
}

export interface CompletionReportItem {
  key: string;
  title: string;
  role: string;
  status: StepStatus;
  detail: string;
  /** Only for blocked/advised items: the exact thing a human must do. */
  unblockRequest?: string | null;
}

export interface CompletionReport {
  generatedAt: string;
  summary: string;
  completed: CompletionReportItem[];
  blocked: CompletionReportItem[];
  failed: CompletionReportItem[];
  pending: CompletionReportItem[];
  spentCents: number;
  budgetCents: number;
}
