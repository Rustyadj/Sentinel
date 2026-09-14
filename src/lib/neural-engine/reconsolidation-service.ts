// Sentinel — reconsolidation.
//
// The join that was missing: `Experience.knowledgeUsed` and MemoryRetrieval
// record what was put in front of a worker, `Evaluation` records how the work
// went, and until now nothing connected them. A memory retrieved before a
// failure was never weakened; one retrieved before a success was never
// confirmed.
//
// Two rules constrain everything here:
//
//   1. Evidence must be independent. A generalized memory being retrieved
//      repeatedly is not evidence for itself, and an experience that helped
//      derive a memory cannot later confirm it. Without this, confidence
//      inflates on nothing.
//   2. History is never overwritten. Weakening adjusts signals; it does not
//      rewrite content. Genuine conflict opens a Contradiction, where the
//      losing claim stays on record.

import { db } from "@/lib/db";
import { recordMemoryUsed, recordMemoryContradiction } from "@/lib/learning/memory-governance";
import { isDerived } from "./memory-provenance";

export interface ResolveOutcomeInput {
  experienceId: string;
  /** 0..1; >= this counts as success. Below it counts as disconfirmation. */
  successScore: number | null;
  outcomeStatus?: string | null;
}

export const SUCCESS_THRESHOLD = 0.5;

export interface ResolveOutcomeResult {
  resolved: number;
  confirmed: number;
  disconfirmed: number;
  skippedNotIndependent: number;
  skippedAlreadyCounted: number;
}

/**
 * Decide whether this experience can serve as independent evidence about this
 * memory.
 *
 * A derived memory cannot be confirmed by an experience that produced it —
 * that is the self-reinforcing loop the design forbids. Observed and
 * user-provided memories are first-hand and carry no such circularity.
 */
export function isIndependentEvidence(
  memory: { provenanceClass: string; derivedFromExperienceIds: string[] },
  experienceId: string,
): boolean {
  if (!isDerived(memory.provenanceClass)) return true;
  return !memory.derivedFromExperienceIds.includes(experienceId);
}

/**
 * Resolve every still-unresolved retrieval attached to one experience, using
 * the outcome that experience actually reached.
 *
 * Only rows with `resolvedAt IS NULL` are touched, so this is idempotent: a
 * second evaluation of the same experience cannot double-count the same
 * retrieval as further evidence.
 */
export async function resolveRetrievalOutcomes(input: ResolveOutcomeInput): Promise<ResolveOutcomeResult> {
  const result: ResolveOutcomeResult = {
    resolved: 0, confirmed: 0, disconfirmed: 0, skippedNotIndependent: 0, skippedAlreadyCounted: 0,
  };
  if (input.successScore == null && !input.outcomeStatus) return result;

  const pending = await db.memoryRetrieval.findMany({
    where: { experienceId: input.experienceId, resolvedAt: null },
    include: { memory: { select: { id: true, provenanceClass: true, derivedFromExperienceIds: true } } },
  });
  if (!pending.length) return result;

  const succeeded = input.successScore != null
    ? input.successScore >= SUCCESS_THRESHOLD
    : input.outcomeStatus === "success";

  // One experience is one piece of evidence about a given memory, however many
  // times that memory was retrieved while the work ran.
  const countedMemoryIds = new Set<string>();

  for (const retrieval of pending) {
    const now = new Date();
    await db.memoryRetrieval.update({
      where: { id: retrieval.id },
      data: {
        outcomeStatus: input.outcomeStatus ?? (succeeded ? "success" : "failure"),
        outcomeScore: input.successScore,
        contributedToOutcome: succeeded,
        resolvedAt: now,
      },
    });
    result.resolved += 1;

    if (countedMemoryIds.has(retrieval.memoryId)) {
      result.skippedAlreadyCounted += 1;
      continue;
    }
    if (!isIndependentEvidence(retrieval.memory, input.experienceId)) {
      result.skippedNotIndependent += 1;
      continue;
    }
    countedMemoryIds.add(retrieval.memoryId);

    if (succeeded) {
      // recordMemoryUsed sets lastUsefulAt and increments confirmationCount —
      // the two signals the decay policy was always meant to read.
      await recordMemoryUsed(retrieval.memoryId);
      result.confirmed += 1;
    } else {
      // A failed task does not make a memory *wrong*, so this is not a
      // contradiction. It is evidence the memory did not help, tracked
      // separately so genuine contradictions keep their own meaning.
      await db.memory.update({
        where: { id: retrieval.memoryId },
        data: { disconfirmationCount: { increment: 1 } },
      }).catch(() => null);
      result.disconfirmed += 1;
    }
  }

  return result;
}

/**
 * Usefulness as observed, not as assumed: the share of independent experiences
 * in which this memory was present for success. Returns null when there is not
 * yet any resolved evidence, so callers can tell "not useful" from "not yet
 * known" rather than treating an unmeasured memory as a bad one.
 */
export function usefulnessRatio(memory: { confirmationCount: number; disconfirmationCount: number }): number | null {
  const total = memory.confirmationCount + memory.disconfirmationCount;
  if (total === 0) return null;
  return memory.confirmationCount / total;
}

/**
 * Record that new evidence genuinely conflicts with what a memory asserts.
 *
 * This is the narrow path: it is for contradiction, not for disappointment.
 * The existing contradiction machinery keeps every competing claim on record,
 * so nothing is overwritten here either.
 */
export async function recordMemoryConflict(memoryId: string): Promise<void> {
  await recordMemoryContradiction(memoryId);
}
