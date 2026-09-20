// Sentinel — applying contradiction assessments to stored memory.
//
// contradiction-detection.ts decides; this enacts. The split matters: the
// judgement is a pure function that can be tested exhaustively and replayed
// against any corpus, and everything that touches a row lives here, behind one
// shadow-mode switch.
//
// The rules this module is built to keep:
//
//   * Nothing is deleted. A superseded memory is closed (validTo) and linked
//     (supersededById). The row, its content and its provenance stay exactly
//     as they were, because a historical query has to be able to return it.
//   * Every decision is recorded, including the ones not acted on. That is
//     what makes shadow mode a measurement rather than a no-op.
//   * An unresolved conflict is recorded, not resolved. Two live claims about
//     the same thing both reach the prompt; guessing between them would be
//     indistinguishable from a real supersession while resting on nothing.

import { db } from "@/lib/db";
import {
  assessContradiction,
  type ComparableMemory,
  type ContradictionAssessment,
} from "./contradiction-detection";
import { recordMemoryContradiction } from "@/lib/learning/memory-governance";

export type ReconsolidationMode = "shadow" | "apply";

/**
 * Shadow by default, everywhere, until benchmark evidence says otherwise.
 *
 * Autonomous rewriting of what the system believes is the highest-consequence
 * thing in this subsystem, so it is opt-in by configuration rather than
 * opt-out. The benchmark runs with "apply" explicitly to produce the evidence.
 */
export function defaultMode(): ReconsolidationMode {
  return process.env.SENTINEL_RECONSOLIDATION_MODE === "apply" ? "apply" : "shadow";
}

const COMPARABLE_SELECT = {
  id: true, content: true, tags: true, scope: true, projectId: true, owner: true,
  confidence: true, createdAt: true, validFrom: true, validTo: true,
  provenanceClass: true, source: true,
} as const;

export interface ReconsolidationOptions {
  mode?: ReconsolidationMode;
  origin?: string;
  /** Below this, a decision is recorded but never enacted even in apply mode. */
  minConfidence?: number;
}

export const MIN_APPLY_CONFIDENCE = 0.6;

export interface ReconsolidationSummary {
  assessed: number;
  recorded: number;
  applied: number;
  superseded: number;
  reinforced: number;
  contradictionsOpened: number;
  mode: ReconsolidationMode;
}

/** Persist one decision. Idempotent on (memory, relatedMemory, action). */
async function recordDecision(
  subject: ComparableMemory,
  related: ComparableMemory,
  assessment: ContradictionAssessment,
  mode: ReconsolidationMode,
  origin: string,
  applied: boolean,
): Promise<void> {
  const data = {
    memoryId: subject.id,
    relatedMemoryId: related.id,
    action: assessment.action,
    confidence: assessment.confidence,
    reason: assessment.reason,
    evidence: assessment.evidence as unknown as object,
    opensContradiction: assessment.opensContradiction,
    shadow: mode === "shadow",
    applied,
    appliedAt: applied ? new Date() : null,
    origin,
  };
  const existing = await db.memoryReconsolidation.findFirst({
    where: { memoryId: subject.id, relatedMemoryId: related.id, action: assessment.action },
    select: { id: true },
  });
  if (existing) {
    await db.memoryReconsolidation.update({ where: { id: existing.id }, data });
    return;
  }
  await db.memoryReconsolidation.create({ data });
}

/**
 * Close `subject` in favour of `cause`.
 *
 * `validTo` is set to the point the replacement became valid, not to now: the
 * old belief stopped being true when the correction was made, and a query
 * asking what was believed in between must get the old answer, not neither.
 */
async function applySupersession(
  subject: ComparableMemory,
  cause: ComparableMemory,
  assessment: ContradictionAssessment,
): Promise<void> {
  await db.memory.update({
    where: { id: subject.id },
    data: {
      validTo: cause.validFrom,
      supersededById: cause.id,
      changeReason: assessment.reason,
      state: "stale",
    },
  });
}

/**
 * Assess one memory against the memories it could plausibly conflict with,
 * and enact whatever the mode allows.
 *
 * The candidate set is narrowed in SQL to the same owner, scope and project —
 * the same boundaries the detector would refuse to cross anyway. Doing it here
 * as well keeps a large corpus from being pulled into memory to be rejected.
 */
export async function reconsolidateMemory(
  memoryId: string,
  options: ReconsolidationOptions = {},
): Promise<ReconsolidationSummary> {
  const mode = options.mode ?? defaultMode();
  const origin = options.origin ?? "sweep";
  const minConfidence = options.minConfidence ?? MIN_APPLY_CONFIDENCE;
  const summary: ReconsolidationSummary = {
    assessed: 0, recorded: 0, applied: 0, superseded: 0, reinforced: 0,
    contradictionsOpened: 0, mode,
  };

  const incoming = await db.memory.findUnique({ where: { id: memoryId }, select: COMPARABLE_SELECT });
  if (!incoming) return summary;

  const candidates = await db.memory.findMany({
    where: {
      id: { not: incoming.id },
      owner: incoming.owner,
      scope: incoming.scope,
      projectId: incoming.projectId,
      archived: false,
      // Already-closed memories cannot be superseded again; the detector
      // rejects them too, this just avoids fetching them.
      validTo: null,
      createdAt: { lt: incoming.createdAt },
    },
    select: COMPARABLE_SELECT,
    take: 200,
  });

  for (const candidate of candidates) {
    const assessment = assessContradiction(incoming, candidate);
    summary.assessed += 1;

    const actionable = assessment.action !== "NO_CHANGE" || assessment.opensContradiction;
    if (!actionable) continue;

    const shouldApply = mode === "apply" && assessment.confidence >= minConfidence;
    let applied = false;

    if (shouldApply) {
      if (assessment.action === "SUPERSEDE") {
        await applySupersession(candidate, incoming, assessment);
        summary.superseded += 1;
        applied = true;
      } else if (assessment.action === "REINFORCE") {
        // Confirmation, not content change: the duplicate is left in place and
        // the original's confirmation count rises. Deleting the duplicate
        // would discard an independently-sourced observation.
        await db.memory.update({
          where: { id: candidate.id },
          data: { confirmationCount: { increment: 1 }, lastValidatedAt: new Date() },
        }).catch(() => null);
        summary.reinforced += 1;
        applied = true;
      }
      // REVISE / MERGE / QUARANTINE / ARCHIVE are recorded but never enacted
      // automatically. Each rewrites or hides content on an inference, which
      // is not something to do without a human or much stronger evidence than
      // this detector can produce.
    }

    if (assessment.opensContradiction) {
      summary.contradictionsOpened += 1;
      if (mode === "apply") {
        // Raises contradictionCount on both sides; at three it moves a memory
        // to "disputed". Neither is removed from retrieval.
        await recordMemoryContradiction(candidate.id).catch(() => null);
      }
    }

    await recordDecision(candidate, incoming, assessment, mode, origin, applied);
    summary.recorded += 1;
    if (applied) summary.applied += 1;
  }

  return summary;
}

/**
 * Run reconsolidation across a scope, oldest memory first.
 *
 * Order matters: processing chronologically means a correction is assessed
 * against the belief it corrects, and a later correction of the correction
 * finds the right target rather than an already-closed one.
 */
export async function reconsolidateScope(
  where: { owner: string; projectId?: string | null },
  options: ReconsolidationOptions = {},
): Promise<ReconsolidationSummary> {
  const mode = options.mode ?? defaultMode();
  const total: ReconsolidationSummary = {
    assessed: 0, recorded: 0, applied: 0, superseded: 0, reinforced: 0,
    contradictionsOpened: 0, mode,
  };

  const memories = await db.memory.findMany({
    where: {
      owner: where.owner,
      ...(where.projectId === undefined ? {} : { projectId: where.projectId }),
      archived: false,
    },
    orderBy: { createdAt: "asc" },
    select: { id: true },
  });

  for (const memory of memories) {
    const summary = await reconsolidateMemory(memory.id, { ...options, mode });
    total.assessed += summary.assessed;
    total.recorded += summary.recorded;
    total.applied += summary.applied;
    total.superseded += summary.superseded;
    total.reinforced += summary.reinforced;
    total.contradictionsOpened += summary.contradictionsOpened;
  }

  return total;
}

/**
 * The provenance answer: what changed about this belief, what replaced it, and
 * on what evidence — reconstructed from stored rows rather than from recall.
 */
export async function explainBeliefChange(memoryId: string) {
  const memory = await db.memory.findUnique({
    where: { id: memoryId },
    select: {
      id: true, content: true, state: true, validFrom: true, validTo: true,
      supersededById: true, changeReason: true,
    },
  });
  if (!memory) return null;

  const decisions = await db.memoryReconsolidation.findMany({
    where: { memoryId },
    orderBy: { createdAt: "asc" },
  });
  const replacement = memory.supersededById
    ? await db.memory.findUnique({
        where: { id: memory.supersededById },
        select: { id: true, content: true, validFrom: true },
      })
    : null;

  return { memory, replacedBy: replacement, decisions };
}
