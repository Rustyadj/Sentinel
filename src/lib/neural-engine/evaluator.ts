// Sentinel Neural Engine — Phase B: deterministic auto-evaluator
//
// Scores a completed Experience from the signals actually available at
// runtime (outcome status, latency, errors) and proposes learning
// candidates. This is intentionally a simple, deterministic heuristic — NOT
// an LLM judge. It is honest about being coarse; a model-based evaluator is a
// later refinement. What matters for Phase B is that the loop actually runs
// end-to-end on real experiences with real, defensible scoring.
//
// Crucially, the candidates it proposes go through the SAME policy gate as
// everything else (learning-service.proposeCandidate → policy-service): a
// single success never auto-strengthens anything. Only when repeated evidence
// crosses the threshold does a confidence_update auto-apply.

import { db } from "@/lib/db";
import { createEvaluation } from "./evaluation-service";
import { proposeCandidate } from "./learning-service";
import { AUTO_APPROVE_MIN_CONFIDENCE } from "./types";

// Latency scoring band (ms). Under FAST → full marks; over SLOW → floor.
const FAST_LATENCY_MS = 3_000;
const SLOW_LATENCY_MS = 30_000;
const EFFICIENCY_FLOOR = 0.3;

// Small per-observation trust nudge when a knowledge object is repeatedly
// implicated in successful (or failed) work.
const WEIGHT_STEP = 0.08;

export interface ExperienceScoreInput {
  outcomeStatus: string;
  latencyMs: number | null;
  hasErrors: boolean;
}

export interface ExperienceScores {
  successScore: number | null;
  qualityScore: number | null;
  efficiencyScore: number;
  safetyScore: number;
  confidence: number;
  critique: string;
}

/**
 * Pure, deterministic scoring — exported so it can be unit-tested without a DB.
 * Every number here is derived, not invented: successScore from outcome,
 * efficiencyScore from latency band, safetyScore from error presence.
 */
export function scoreExperience(input: ExperienceScoreInput): ExperienceScores {
  const { outcomeStatus, latencyMs, hasErrors } = input;

  let successScore: number | null;
  switch (outcomeStatus) {
    case "success":
      successScore = 1;
      break;
    case "partial":
      successScore = 0.6;
      break;
    case "failure":
      successScore = 0;
      break;
    default:
      // cancelled / in_progress → no meaningful success signal
      successScore = null;
  }

  // Efficiency: full marks under FAST, linear decay to EFFICIENCY_FLOOR at SLOW.
  let efficiencyScore: number;
  if (latencyMs == null) {
    efficiencyScore = 0.6; // unknown latency → neutral-ish
  } else if (latencyMs <= FAST_LATENCY_MS) {
    efficiencyScore = 1;
  } else if (latencyMs >= SLOW_LATENCY_MS) {
    efficiencyScore = EFFICIENCY_FLOOR;
  } else {
    const t = (latencyMs - FAST_LATENCY_MS) / (SLOW_LATENCY_MS - FAST_LATENCY_MS);
    efficiencyScore = 1 - t * (1 - EFFICIENCY_FLOOR);
  }

  // Safety: conservative. Errors present → reduced but not zero (an error is
  // not inherently a safety violation, but it warrants a flag).
  const safetyScore = hasErrors ? 0.7 : 1;

  // Quality is the weakest signal without inspecting output — use success as a
  // proxy and label it honestly in the critique rather than pretending to
  // judge content.
  const qualityScore = successScore == null ? null : successScore >= 0.5 ? 0.6 : 0.2;

  // Confidence in this evaluation reflects how much signal we actually had.
  let confidence = 0.4;
  if (latencyMs != null) confidence += 0.2;
  if (successScore != null) confidence += 0.2;
  confidence = Math.min(0.9, confidence);

  const critique =
    `Deterministic heuristic evaluation (no content inspection): ` +
    `outcome=${outcomeStatus}, latency=${latencyMs ?? "unknown"}ms, ` +
    `errors=${hasErrors}. qualityScore is a success-derived proxy.`;

  return { successScore, qualityScore, efficiencyScore, safetyScore, confidence, critique };
}

/** Count prior experiences by this agent that used `objectId` with a given outcome. */
export async function countPriorKnowledgeUses(
  agentId: string,
  objectId: string,
  outcomeStatus: "success" | "failure",
  excludeExperienceId?: string,
): Promise<number> {
  return db.experience.count({
    where: {
      agentId,
      outcomeStatus,
      knowledgeUsed: { has: objectId },
      ...(excludeExperienceId ? { id: { not: excludeExperienceId } } : {}),
    },
  });
}

export interface AutoEvaluateResult {
  evaluationId: string;
  proposedCandidateIds: string[];
  autoAppliedCandidateIds: string[];
}

/**
 * Evaluate a completed experience and propose learning from it.
 *
 * For each knowledge object the experience used, we count how often this agent
 * has previously seen the SAME object tied to the SAME outcome. That running
 * count becomes the candidate's evidenceCount — so a confidence_update only
 * auto-applies once the object has repeatedly (>= threshold) been part of the
 * agent's successes/failures. One-off results queue for review; they never
 * silently move canonical trust.
 */
export async function autoEvaluateExperience(
  experienceId: string,
  evaluatorAgentId?: string | null,
): Promise<AutoEvaluateResult> {
  const experience = await db.experience.findUniqueOrThrow({
    where: { id: experienceId },
    include: { outcome: true },
  });

  if (experience.outcomeStatus === "in_progress") {
    throw new Error(
      `Cannot evaluate experience ${experienceId} — it is still in_progress.`,
    );
  }

  const errors = experience.outcome?.errors;
  const hasErrors = Array.isArray(errors) && errors.length > 0;

  const scores = scoreExperience({
    outcomeStatus: experience.outcomeStatus,
    latencyMs: experience.latencyMs,
    hasErrors,
  });

  const evaluation = await createEvaluation({
    experienceId,
    evaluatorAgentId: evaluatorAgentId ?? null,
    successScore: scores.successScore,
    qualityScore: scores.qualityScore,
    efficiencyScore: scores.efficiencyScore,
    safetyScore: scores.safetyScore,
    confidence: scores.confidence,
    critique: scores.critique,
    evidence: {
      outcomeStatus: experience.outcomeStatus,
      latencyMs: experience.latencyMs,
      hasErrors,
    },
  });

  const proposedCandidateIds: string[] = [];
  const autoAppliedCandidateIds: string[] = [];

  // Only propose weight changes when there is a clear success/failure signal
  // and the experience actually consulted knowledge.
  const outcome =
    scores.successScore == null
      ? null
      : scores.successScore >= 0.5
        ? ("success" as const)
        : ("failure" as const);

  if (outcome && experience.knowledgeUsed.length > 0) {
    for (const objectId of experience.knowledgeUsed) {
      // Evidence = how many times this agent has already had this object tied
      // to this same outcome (including the current experience).
      const priorCount = await countPriorKnowledgeUses(
        experience.agentId,
        objectId,
        outcome,
      );
      const evidenceCount = Math.max(1, priorCount);

      const { candidate, autoApplied } = await proposeCandidate({
        experienceId,
        evaluationId: evaluation.id,
        type: "confidence_update",
        proposedPayload: {
          agentId: experience.agentId,
          knowledgeObjectId: objectId,
          outcome,
          magnitude: WEIGHT_STEP,
        },
        targetType: "agent_weight",
        evidenceCount,
        // Confidence rises with repeated evidence; clamped so a single
        // observation can't reach the auto-approve threshold on its own.
        confidence: Math.min(
          0.95,
          scores.confidence + Math.min(0.4, evidenceCount * 0.12),
        ),
      });

      proposedCandidateIds.push(candidate.id);
      if (autoApplied) autoAppliedCandidateIds.push(candidate.id);
    }
  }

  return {
    evaluationId: evaluation.id,
    proposedCandidateIds,
    autoAppliedCandidateIds,
  };
}

/** Exposed for tests/telemetry: the confidence an evaluation must reach for auto-apply. */
export const AUTO_APPLY_CONFIDENCE_TARGET = AUTO_APPROVE_MIN_CONFIDENCE;
