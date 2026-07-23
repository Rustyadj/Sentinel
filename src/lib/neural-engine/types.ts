// Sentinel Neural Engine — Phase A domain types
// No imports from sibling files (mirrors src/lib/knowledge/types.ts convention).

export type LearningCandidateType =
  | "memory"
  | "decision"
  | "skill"
  | "procedure"
  | "relationship"
  | "confidence_update"
  | "contradiction"
  | "prompt_change"
  | "tool_policy_change";

export type RiskLevel = "low" | "medium" | "high";

export type LearningCandidateStatus =
  | "proposed"
  | "approved"
  | "rejected"
  | "auto_approved"
  | "rolled_back";

export type ExperienceOutcomeStatus =
  | "in_progress"
  | "success"
  | "partial"
  | "failure"
  | "cancelled";

export type OutcomeStatus = "success" | "partial" | "failure" | "cancelled";

/**
 * Hard rule (see docs/neural-engine/PHASE_A_CONFLICTS.md and the delivery
 * plan's "SELF-IMPROVEMENT SAFETY" section): these LearningCandidate types
 * touch surfaces that must never be auto-approved, regardless of evidence
 * count or confidence. Always high risk, always human-reviewed.
 */
export const ALWAYS_HIGH_RISK_TYPES: ReadonlySet<LearningCandidateType> = new Set([
  "prompt_change",
  "tool_policy_change",
]);

/**
 * Low-risk candidate types that MAY be auto-approved when evidence/confidence
 * thresholds are met. Everything else defaults to requiring review.
 * Per the plan: retrieval weight adjustment, recency decay, repeated
 * preference reinforcement, competency score update, low-impact procedure
 * refinement, duplicate relationship consolidation.
 */
export const AUTO_APPROVABLE_TYPES: ReadonlySet<LearningCandidateType> = new Set([
  "confidence_update",
  "relationship",
]);

export interface ExperienceInput {
  agentId: string;
  actingUserId?: string | null;
  requestId?: string | null;
  maxRuntimeMs?: number | null;
  maxCost?: number | null;
  projectId?: string | null;
  workspaceId?: string | null;
  organizationId?: string | null;
  taskId?: string | null;
  conversationId?: string | null;
  objective: string;
  contextSnapshot?: Record<string, unknown>;
  toolsUsed?: string[];
  knowledgeUsed?: string[];
}

export interface OutcomeInput {
  status: OutcomeStatus;
  metrics?: Record<string, unknown>;
  errors?: unknown[];
  externalSignals?: Record<string, unknown>;
  userAccepted?: boolean | null;
}

export interface EvaluationInput {
  experienceId: string;
  evaluatorAgentId?: string | null;
  successScore?: number | null;
  qualityScore?: number | null;
  efficiencyScore?: number | null;
  safetyScore?: number | null;
  confidence?: number;
  critique?: string | null;
  evidence?: Record<string, unknown>;
}

export interface ProposedLearningCandidateInput {
  experienceId?: string | null;
  evaluationId?: string | null;
  type: LearningCandidateType;
  proposedPayload: Record<string, unknown>;
  targetType?: string | null;
  riskLevel?: RiskLevel;
  evidenceCount?: number;
  confidence?: number;
}

/**
 * Auto-approval policy thresholds. Kept as plain constants rather than a
 * configurable Policy row for Phase A — promoting this into a real `Policy`
 * record (domain: "learning-review") is a natural Phase B follow-up so it
 * can be tuned without a deploy.
 */
export const AUTO_APPROVE_MIN_EVIDENCE = 3;
export const AUTO_APPROVE_MIN_CONFIDENCE = 0.75;
