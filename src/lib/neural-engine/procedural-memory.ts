// Sentinel — the procedural lane: how a workflow that worked becomes a rule,
// and how it stops being one.
//
// Procedures are not stored anywhere new. A procedural memory is a Memory in
// the PROCEDURAL lane (type "skill"), so it inherits scope, authorization,
// bitemporal validity, supersession and query-aware retrieval rather than
// getting a parallel set of all of those that would drift.
//
// What the lane adds is a promotion lifecycle, because the failure mode here
// is specific and severe: a procedure that worked once is indistinguishable,
// as a row, from one that has worked twenty times, and if the first can reach
// a prompt as established practice then a single lucky run becomes a universal
// rule. So a new procedure starts in shadow — recorded, scored, linked, and
// excluded from production retrieval — and leaves it only on evidence.
//
// The evidence rules are inherited deliberately:
//
//   * An execution that helped *derive* a procedure can never later confirm
//     it (isIndependentEvidence). Otherwise confidence inflates on nothing.
//   * One execution is one piece of evidence however many times the procedure
//     was used inside it. supportingExperienceIds exists to enforce this;
//     confirmationCount alone cannot, because it has no provenance.

import { db } from "@/lib/db";
import { isIndependentEvidence } from "./reconsolidation-service";
import { defaultMode, type ReconsolidationMode } from "./reconsolidation-engine";

/** Distinct successful executions before a procedure may leave shadow. */
export const PROMOTION_MIN_SUCCESSES = 3;
/** Share of independent executions that must have succeeded. */
export const PROMOTION_MIN_SUCCESS_RATIO = 0.8;
/** Failure share at which a promoted procedure is pulled back into shadow. */
export const DEMOTION_FAILURE_RATIO = 0.5;

export type PromotionAction = "PROMOTE" | "HOLD" | "DEMOTE" | "QUARANTINE" | "NO_CHANGE";

export interface PromotionAssessment {
  action: PromotionAction;
  reason: string;
  successes: number;
  failures: number;
  successRatio: number | null;
  shadowOnly: boolean;
}

interface ProcedureRow {
  id: string;
  shadowOnly: boolean;
  state: string;
  confirmationCount: number;
  disconfirmationCount: number;
  supportingExperienceIds: string[];
}

/**
 * Decide, from evidence alone, whether a procedure should be trusted.
 *
 * Pure, so the policy can be tested exhaustively without a database and
 * reviewed without reading the code that applies it.
 */
export function assessPromotion(procedure: ProcedureRow): PromotionAssessment {
  const successes = procedure.confirmationCount;
  const failures = procedure.disconfirmationCount;
  const total = successes + failures;
  const successRatio = total === 0 ? null : successes / total;
  const base = { successes, failures, successRatio, shadowOnly: procedure.shadowOnly };

  if (total === 0) {
    return { ...base, action: procedure.shadowOnly ? "HOLD" : "NO_CHANGE", reason: "no independent executions yet" };
  }

  // Demotion is checked before promotion so a procedure that is failing
  // cannot be promoted by a success count that crossed the threshold on the
  // way down.
  if (successRatio !== null && 1 - successRatio >= DEMOTION_FAILURE_RATIO) {
    if (!procedure.shadowOnly) {
      return { ...base, action: "DEMOTE", reason: `failing in ${failures} of ${total} independent executions` };
    }
    return { ...base, action: "HOLD", reason: `failing in ${failures} of ${total} executions; stays in shadow` };
  }

  if (!procedure.shadowOnly) {
    return { ...base, action: "NO_CHANGE", reason: "already promoted and still performing" };
  }

  if (successes < PROMOTION_MIN_SUCCESSES) {
    return {
      ...base,
      action: "HOLD",
      reason: `${successes} of ${PROMOTION_MIN_SUCCESSES} independent successes; one success is not a rule`,
    };
  }
  if (successRatio !== null && successRatio < PROMOTION_MIN_SUCCESS_RATIO) {
    return { ...base, action: "HOLD", reason: `success ratio ${successRatio.toFixed(2)} below ${PROMOTION_MIN_SUCCESS_RATIO}` };
  }

  return { ...base, action: "PROMOTE", reason: `${successes} independent successes at ratio ${successRatio?.toFixed(2)}` };
}

const PROCEDURE_SELECT = {
  id: true, shadowOnly: true, state: true, confirmationCount: true,
  disconfirmationCount: true, supportingExperienceIds: true,
  provenanceClass: true, derivedFromExperienceIds: true,
} as const;

export interface RecordOutcomeResult {
  counted: boolean;
  reason: string;
  assessment: PromotionAssessment | null;
}

/**
 * Record that one execution used this procedure and how it went.
 *
 * Returns `counted: false` — not an error — when the execution cannot serve as
 * evidence. Silently counting it anyway is how a procedure's confidence comes
 * to rest on its own output.
 */
export async function recordProcedureOutcome(input: {
  memoryId: string;
  experienceId: string;
  succeeded: boolean;
  mode?: ReconsolidationMode;
}): Promise<RecordOutcomeResult> {
  const procedure = await db.memory.findUnique({ where: { id: input.memoryId }, select: PROCEDURE_SELECT });
  if (!procedure) return { counted: false, reason: "procedure not found", assessment: null };

  if (!isIndependentEvidence(procedure, input.experienceId)) {
    return {
      counted: false,
      reason: "this execution helped derive the procedure and cannot also confirm it",
      assessment: assessPromotion(procedure),
    };
  }
  if (procedure.supportingExperienceIds.includes(input.experienceId)) {
    return {
      counted: false,
      reason: "this execution has already been counted",
      assessment: assessPromotion(procedure),
    };
  }

  const updated = await db.memory.update({
    where: { id: input.memoryId },
    data: {
      supportingExperienceIds: { push: input.experienceId },
      ...(input.succeeded
        ? { confirmationCount: { increment: 1 }, lastUsefulAt: new Date(), lastValidatedAt: new Date() }
        : { disconfirmationCount: { increment: 1 } }),
    },
    select: PROCEDURE_SELECT,
  });

  const assessment = assessPromotion(updated);
  await applyPromotion(input.memoryId, assessment, input.mode ?? defaultMode());
  return { counted: true, reason: input.succeeded ? "counted as a success" : "counted as a failure", assessment };
}

/**
 * Enact a promotion decision, or record it and do nothing.
 *
 * Shadow by default. Promotion is the act of letting a procedure influence
 * real work, so it is opt-in by configuration rather than opt-out, and the
 * decision is written either way so the policy can be reviewed against what it
 * would have done.
 */
export async function applyPromotion(
  memoryId: string,
  assessment: PromotionAssessment,
  mode: ReconsolidationMode,
): Promise<void> {
  if (assessment.action === "HOLD" || assessment.action === "NO_CHANGE") return;

  const apply = mode === "apply";
  if (apply) {
    if (assessment.action === "PROMOTE") {
      await db.memory.update({
        where: { id: memoryId },
        data: { shadowOnly: false, state: "stable", lastValidatedAt: new Date() },
      });
    } else if (assessment.action === "DEMOTE") {
      // Back to shadow, not deleted: a procedure that stopped working is
      // evidence about the world, and the executions that disproved it are
      // exactly what a later revision needs.
      await db.memory.update({ where: { id: memoryId }, data: { shadowOnly: true, state: "disputed" } });
    } else if (assessment.action === "QUARANTINE") {
      await db.memory.update({ where: { id: memoryId }, data: { state: "quarantined" } });
    }
  }

  await db.memoryReconsolidation.create({
    data: {
      memoryId,
      action: assessment.action === "PROMOTE" ? "REINFORCE" : "REVISE",
      confidence: assessment.successRatio ?? 0,
      reason: `procedural ${assessment.action.toLowerCase()}: ${assessment.reason}`,
      evidence: [
        { code: "independent_successes", detail: String(assessment.successes), weight: 0 },
        { code: "independent_failures", detail: String(assessment.failures), weight: 0 },
      ] as unknown as object,
      shadow: !apply,
      applied: apply,
      appliedAt: apply ? new Date() : null,
      origin: "procedural-promotion",
    },
  }).catch(() => null);
}

/**
 * Procedures awaiting evidence.
 *
 * The shadow set is the honest picture of what Sentinel has noticed but not
 * yet earned the right to act on.
 */
export async function shadowedProcedures(owner?: string) {
  return db.memory.findMany({
    where: { type: "skill", shadowOnly: true, ...(owner ? { owner } : {}) },
    select: {
      id: true, content: true, owner: true, projectId: true,
      confirmationCount: true, disconfirmationCount: true, supportingExperienceIds: true,
    },
    orderBy: { confirmationCount: "desc" },
  });
}
