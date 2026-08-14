// Sentinel Guardian — independent monitoring role.
//
// Guardian does not replace the canonical risk gate — it observes/reviews/
// blocks around it. `classifyRiskLevel` (policy-service.ts) remains the one
// place the never-auto-approve list lives; Guardian's `tier` is derived from
// that same classification (low/medium/high -> 1/2/3) so the two can never
// silently disagree about what's protected. Guardian evidence is persisted
// as concise structured decision evidence only — no private internal
// reasoning, matching the discipline LearningEvent redaction already
// enforces elsewhere in this codebase.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { classifyRiskLevel } from "@/lib/neural-engine/policy-service";
import type { LearningCandidateType, RiskLevel } from "@/lib/neural-engine/types";
import { emitLearningEvent } from "./event-service";
import { syncGuardianDecisionNode } from "./graph-sync";

export type GuardianMode = "observe" | "review" | "block";
export type GuardianVerdict = "allow" | "hold" | "block";

const TIER_MODE: Record<1 | 2 | 3, GuardianMode> = {
  1: "observe",
  2: "review",
  3: "block",
};

function riskToTier(risk: RiskLevel): 1 | 2 | 3 {
  if (risk === "low") return 1;
  if (risk === "medium") return 2;
  return 3;
}

/**
 * Deterministic, high-confidence patterns Guardian can block on directly
 * without waiting for a human — the "BLOCK: Guardian can prevent execution
 * when deterministic policy or high-confidence security rules are violated"
 * mode. Kept narrow and explicit on purpose: false positives here block real
 * work, so this only matches unambiguous attack/escalation shapes, not
 * anything resembling ordinary content.
 */
export const HARD_BLOCK_PATTERNS: Array<{ reasonCode: string; test: (actionText: string) => boolean }> = [
  {
    reasonCode: "prompt_hierarchy_override",
    // Up to 4 words of slack between the trigger verb and its object so
    // "ignore all previous instructions" (two modifiers) matches just as
    // reliably as "ignore instructions" (zero modifiers).
    test: (t) => /\b(ignore|disregard)\b(?:\s+\S+){0,4}\s+(instructions|rules)\b/i.test(t),
  },
  {
    reasonCode: "credential_exfiltration_attempt",
    test: (t) => /\b(dump|exfiltrate|print|reveal)\b.{0,20}\b(api[_-]?key|secret|credential|password|token)\b/i.test(t),
  },
  {
    reasonCode: "path_traversal_attempt",
    test: (t) => /(\.\.\/){2,}|\/etc\/(passwd|shadow)\b/.test(t),
  },
  {
    reasonCode: "fake_approval_marker",
    test: (t) => /\[?approved by (guardian|system|admin)\]?\s*:?\s*(bypass|skip|override)/i.test(t),
  },
];

/** Reused by adversarial self-play to judge whether a crafted attack payload would be caught by Guardian's deterministic hard-block rules. */
export function matchesHardBlockPattern(actionText: string): string | null {
  return HARD_BLOCK_PATTERNS.find((pattern) => pattern.test(actionText))?.reasonCode ?? null;
}

export interface EvaluateGuardianInput {
  action: string;
  actor: string;
  runtime?: string | null;
  candidateId?: string | null;
  candidateType?: LearningCandidateType;
  riskLevel?: RiskLevel;
  workspaceId?: string | null;
  /** True when a real human has already authorized this specific action (Tier 3 gate). */
  humanAuthorized?: boolean;
  /** Guardian must never approve its own privilege elevation — set true when `actor` IS the guardian/system automation itself proposing to expand its own authority. */
  isSelfElevation?: boolean;
}

export interface GuardianEvaluation {
  decision: Awaited<ReturnType<typeof db.guardianDecision.create>>;
  verdict: GuardianVerdict;
  mode: GuardianMode;
  tier: 1 | 2 | 3;
  allowed: boolean;
}

/**
 * Central Guardian gate. Every governed action (runtime commands, tool
 * calls, memory writes, skill changes, candidate promotion, workflow
 * changes, permission elevation, destructive operations, deployment,
 * external communication, security-sensitive requests) should route through
 * this before executing, per Workstream 4. Persists a GuardianDecision row
 * regardless of verdict — OBSERVE mode still writes evidence, it just never
 * blocks.
 */
export async function evaluateGuardian(input: EvaluateGuardianInput): Promise<GuardianEvaluation> {
  const classification = classifyRiskLevel(
    (input.candidateType as LearningCandidateType | undefined) ?? "confidence_update",
    input.riskLevel,
  );
  const tier = riskToTier(classification.riskLevel);
  const mode = TIER_MODE[tier];

  const reasonCodes: string[] = [];
  let verdict: GuardianVerdict = "allow";
  let confidence = 0.9;

  // Guardian can never approve its own elevation, at any tier — checked
  // before anything else so no downstream branch can accidentally allow it.
  if (input.isSelfElevation) {
    verdict = "block";
    reasonCodes.push("guardian_self_elevation_forbidden");
  } else {
    const hardMatch = HARD_BLOCK_PATTERNS.find((pattern) => pattern.test(input.action));
    if (hardMatch) {
      verdict = "block";
      reasonCodes.push(hardMatch.reasonCode);
      confidence = 0.98;
    } else if (tier === 3) {
      // Human approval remains mandatory at Tier 3 — no trust score, no
      // Guardian confidence, nothing can substitute for it.
      if (input.humanAuthorized) {
        verdict = "allow";
        reasonCodes.push("tier3_human_authorized");
      } else {
        verdict = "block";
        reasonCodes.push("tier3_requires_human_approval");
      }
    } else if (tier === 2) {
      // Tier 2 requires Guardian review before rollout — REVIEW mode holds
      // (not blocks) pending that review; callers treat "hold" as "do not
      // proceed until reviewed", which for automated pipelines means a human
      // or a subsequent evaluateGuardian call with reviewApproved=true.
      verdict = "hold";
      reasonCodes.push("tier2_guardian_review_required");
    } else {
      verdict = "allow";
      reasonCodes.push("tier1_observed");
    }
  }

  const decision = await db.guardianDecision.create({
    data: {
      action: input.action.slice(0, 2000),
      actor: input.actor,
      runtime: input.runtime ?? null,
      candidateId: input.candidateId ?? null,
      tier,
      mode,
      risk: classification.riskLevel,
      policyDecision: classification.reason,
      guardianDecision: verdict,
      confidence,
      reasonCodes,
      evidence: {
        classification: classification.riskLevel,
        autoApproveEligible: classification.autoApproveEligible,
      } as Prisma.InputJsonValue,
      blocked: verdict === "block",
      workspaceId: input.workspaceId ?? null,
    },
  });

  const nodeId = await syncGuardianDecisionNode(decision);
  if (input.candidateId) {
    const { syncCandidateNode } = await import("./graph-sync");
    const candidate = await db.learningCandidate.findUnique({ where: { id: input.candidateId } });
    if (candidate) {
      const candidateNodeId = await syncCandidateNode({ ...candidate, workspaceId: input.workspaceId ?? null });
      const { linkLearningEdge } = await import("./graph-sync");
      await linkLearningEdge(nodeId, candidateNodeId, "evaluated_by");
      if (verdict === "block") await linkLearningEdge(nodeId, candidateNodeId, "protected_by");
    }
  }

  await emitLearningEvent({
    eventType: `guardian.${verdict}`,
    sourceType: "guardian_decision",
    sourceId: decision.id,
    workspaceId: input.workspaceId ?? undefined,
    severity: verdict === "block" ? "warning" : "info",
    payload: { action: input.action.slice(0, 400), actor: input.actor, tier, mode, reasonCodes },
  }).catch(() => {});

  return { decision, verdict, mode, tier, allowed: verdict === "allow" };
}

export interface ReviewGuardianDecisionInput {
  decisionId: string;
  reviewerId: string;
  approve: boolean;
  notes?: string;
}

/**
 * Human resolution of a Tier 2 "hold". Guardian itself never converts its
 * own hold into an allow — a human reviewer id is required, and a reviewer
 * cannot resolve their own guardian-authored elevation request (mirrors the
 * "Guardian cannot self-approve its own privilege elevation" test
 * requirement at the review step too).
 */
export async function resolveGuardianReview(input: ReviewGuardianDecisionInput) {
  const decision = await db.guardianDecision.findUniqueOrThrow({ where: { id: input.decisionId } });
  if (decision.mode !== "review") {
    throw new Error(`GuardianDecision ${input.decisionId} is not in review mode (mode="${decision.mode}").`);
  }
  if (decision.actor === input.reviewerId) {
    throw new Error("A reviewer cannot resolve their own guardian review.");
  }
  const reviewer = await db.user.findUnique({ where: { id: input.reviewerId }, select: { id: true } });
  if (!reviewer) {
    throw new Error("Guardian review requires an authenticated human reviewer.");
  }

  const updated = await db.guardianDecision.update({
    where: { id: input.decisionId },
    data: {
      guardianDecision: input.approve ? "allow" : "block",
      blocked: !input.approve,
      evidence: {
        ...(decision.evidence as Record<string, unknown>),
        reviewedBy: input.reviewerId,
        reviewNotes: input.notes ?? null,
      } as Prisma.InputJsonValue,
    },
  });

  await emitLearningEvent({
    eventType: `guardian.review_${input.approve ? "approved" : "rejected"}`,
    sourceType: "guardian_decision",
    sourceId: updated.id,
    userId: input.reviewerId,
    workspaceId: updated.workspaceId ?? undefined,
    payload: { candidateId: updated.candidateId, notes: input.notes ?? null },
  }).catch(() => {});

  return updated;
}

export async function listGuardianDecisions(params: {
  mode?: GuardianMode;
  candidateId?: string;
  blockedOnly?: boolean;
  workspaceId?: string;
  limit?: number;
} = {}) {
  return db.guardianDecision.findMany({
    where: {
      ...(params.mode ? { mode: params.mode } : {}),
      ...(params.candidateId ? { candidateId: params.candidateId } : {}),
      ...(params.blockedOnly ? { blocked: true } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 100,
  });
}
