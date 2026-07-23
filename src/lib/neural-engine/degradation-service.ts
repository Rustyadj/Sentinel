// Sentinel Neural Engine — Phase E: degradation detection
//
// Closes the loop the plan called for in step 7 of the learning loop:
// "compare later results against the prior strategy; automatically roll back
// harmful learning when confidence drops below threshold." Phase A shipped
// `monitorAndAutoRollback(candidateId, currentConfidence, threshold)` as a
// real, callable function with nothing computing `currentConfidence` for it.
// This file is that missing piece: it derives a real confidence signal from
// before/after Experience outcomes, not a placeholder number.
//
// Honesty note: there is no in-process scheduler in this repo (no cron, no
// background worker) — see docs/neural-engine/PHASE_A_CONFLICTS.md's stance
// on not inventing infrastructure that doesn't exist. `runDegradationSweep`
// is a real, complete function; something external (Vercel Cron, a
// GitHub Action, an ops script) has to call the route that wraps it.

import { db } from "@/lib/db";
import { monitorAndAutoRollback } from "./learning-service";

/** Minimum "after" evidence before we trust a degradation signal at all. */
const MIN_AFTER_EVIDENCE = 3;
/** Rollback threshold passed through to monitorAndAutoRollback. */
const DEGRADATION_CONFIDENCE_THRESHOLD = 0.3;
/** How far back "before" evidence is allowed to reach. */
const BEFORE_WINDOW_DAYS = 30;

export interface WindowStats {
  successRate: number;
  n: number;
}

export interface DegradationCheck {
  candidateId: string;
  before: WindowStats;
  after: WindowStats;
  /** Derived confidence that the strengthening was correct — fed to monitorAndAutoRollback. */
  currentConfidence: number;
  degraded: boolean;
  reason: string;
}

function successRateOf(experiences: { outcomeStatus: string }[]): WindowStats {
  if (experiences.length === 0) return { successRate: 0.5, n: 0 }; // no evidence = neutral, not "bad"
  const successes = experiences.filter((e) => e.outcomeStatus === "success").length;
  return { successRate: successes / experiences.length, n: experiences.length };
}

/**
 * Given a `confidence_update` LearningCandidate that was applied, compare the
 * agent's success rate on that KnowledgeObject before vs. after the
 * strengthening took effect. A real drop with enough post-evidence is
 * "degradation" — the object turned out less trustworthy than the candidate
 * assumed.
 */
export async function checkCandidateForDegradation(
  candidateId: string,
): Promise<DegradationCheck | null> {
  const candidate = await db.learningCandidate.findUnique({ where: { id: candidateId } });
  if (!candidate) return null;
  if (candidate.type !== "confidence_update") return null;
  if (candidate.status !== "approved" && candidate.status !== "auto_approved") return null;
  if (!candidate.resolvedAt) return null;

  const payload = candidate.proposedPayload as {
    agentId?: string;
    knowledgeObjectId?: string;
  };
  if (!payload.agentId || !payload.knowledgeObjectId) return null;

  const resolvedAt = candidate.resolvedAt;
  const beforeStart = new Date(resolvedAt.getTime() - BEFORE_WINDOW_DAYS * 24 * 60 * 60 * 1000);

  const [beforeExperiences, afterExperiences] = await Promise.all([
    db.experience.findMany({
      where: {
        agentId: payload.agentId,
        knowledgeUsed: { has: payload.knowledgeObjectId },
        outcomeStatus: { in: ["success", "partial", "failure"] },
        createdAt: { gte: beforeStart, lt: resolvedAt },
      },
      select: { outcomeStatus: true },
    }),
    db.experience.findMany({
      where: {
        agentId: payload.agentId,
        knowledgeUsed: { has: payload.knowledgeObjectId },
        outcomeStatus: { in: ["success", "partial", "failure"] },
        createdAt: { gte: resolvedAt },
      },
      select: { outcomeStatus: true },
    }),
  ]);

  const before = successRateOf(beforeExperiences);
  const after = successRateOf(afterExperiences);

  if (after.n < MIN_AFTER_EVIDENCE) {
    return {
      candidateId,
      before,
      after,
      currentConfidence: 0.5,
      degraded: false,
      reason: `Only ${after.n} post-strengthening observation(s) — below the ${MIN_AFTER_EVIDENCE} needed to judge.`,
    };
  }

  // currentConfidence: how much the after-window supports the strengthening
  // that was applied. A drop relative to the before-window (or, with no
  // before-evidence, an outright poor after-rate) lowers confidence.
  const drop = before.n > 0 ? before.successRate - after.successRate : 0;
  const currentConfidence =
    before.n > 0 ? Math.max(0, Math.min(1, after.successRate - Math.max(0, drop) * 0.5)) : after.successRate;

  const degraded = currentConfidence < DEGRADATION_CONFIDENCE_THRESHOLD;
  const reason = degraded
    ? `Success rate ${(after.successRate * 100).toFixed(0)}% after strengthening` +
      (before.n > 0 ? ` vs. ${(before.successRate * 100).toFixed(0)}% before` : " (no prior baseline)") +
      ` — derived confidence ${currentConfidence.toFixed(2)} < ${DEGRADATION_CONFIDENCE_THRESHOLD} threshold.`
    : `Derived confidence ${currentConfidence.toFixed(2)} — no degradation detected.`;

  return { candidateId, before, after, currentConfidence, degraded, reason };
}

export interface DegradationSweepResult {
  checked: number;
  rolledBack: string[];
  skippedInsufficientEvidence: number;
}

/**
 * Sweep every applied confidence_update candidate and roll back the ones
 * that degraded. Intended to be invoked periodically by something external
 * to this process (see file header) via POST /api/neural/degradation/sweep.
 */
export async function runDegradationSweep(): Promise<DegradationSweepResult> {
  const candidates = await db.learningCandidate.findMany({
    where: {
      type: "confidence_update",
      status: { in: ["approved", "auto_approved"] },
    },
    select: { id: true },
  });

  let skippedInsufficientEvidence = 0;
  const rolledBack: string[] = [];

  for (const { id } of candidates) {
    const check = await checkCandidateForDegradation(id);
    if (!check) continue;
    if (check.after.n < MIN_AFTER_EVIDENCE) {
      skippedInsufficientEvidence++;
      continue;
    }
    if (check.degraded) {
      const result = await monitorAndAutoRollback(
        id,
        check.currentConfidence,
        DEGRADATION_CONFIDENCE_THRESHOLD,
      );
      if (result) rolledBack.push(id);
    }
  }

  return { checked: candidates.length, rolledBack, skippedInsufficientEvidence };
}
