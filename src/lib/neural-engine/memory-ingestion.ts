// Sentinel — the governed way for something that happened to become memory.
//
// The selective-persistence gate has existed since an earlier commit and was
// reachable from nowhere: `classifyForIngestion` had no callers, so every
// Memory row was written by a direct `db.memory.create` that asked no
// questions. The gate decided nothing because nothing consulted it.
//
// This is the entry point that does, and it composes the pieces that were
// already built but never joined:
//
//   classifyForIngestion   — should this be remembered, as what, and why
//   assertWritableMemoryScope — may this caller write it here at all
//   reconsolidateMemory    — does it contradict something already believed
//
// The order is deliberate. Authorization is checked before the gate runs, so a
// caller cannot learn anything about another tenant's stored memory from a
// duplicate-detection result. The gate runs before the write, so a rejected
// observation never becomes a row. Reconsolidation runs after, so a correction
// is linked to what it corrects at the moment it is stored rather than by a
// sweep that may not run for hours.

import { db } from "@/lib/db";
import { classifyForIngestion, type IngestionVerdict, memoryTypeForLane } from "./ingestion-gate";
import { assertWritableMemoryScope } from "@/lib/knowledge/memory-scope";
import { reconsolidateMemory, defaultMode, type ReconsolidationMode } from "./reconsolidation-engine";

export interface RememberInput {
  content: string;
  owner: string;
  speaker?: string;
  source?: string;
  scope?: "session" | "project" | "workspace" | "user" | "global";
  projectId?: string | null;
  workspaceId?: string | null;
  tags?: string[];
  /** When the described event happened, for episodic ordering. */
  eventTime?: Date | null;
  /** Sources that can be queried on demand; the gate declines to duplicate them. */
  authoritativeSources?: string[];
  /** Overrides the shadow default for the reconsolidation that follows. */
  reconsolidationMode?: ReconsolidationMode;
}

export interface RememberResult {
  accepted: boolean;
  memoryId: string | null;
  verdict: IngestionVerdict;
  decisionId: string;
}

/** How many in-scope memories to compare against for duplicate detection. */
const DUPLICATE_WINDOW = 200;

/**
 * Offer an observation to memory.
 *
 * Always returns a verdict and always records it, accepted or not. A rejection
 * is a result, not an error: the caller asked whether this should be
 * remembered and got an answer, with the reasons attached.
 */
export async function remember(input: RememberInput): Promise<RememberResult> {
  const scope = input.scope ?? (input.projectId ? "project" : "user");
  const workspaceId = input.workspaceId ?? null;
  const projectId = input.projectId ?? null;

  // Authorization first. Running the gate before this would let a caller probe
  // another tenant's corpus through duplicate detection: "was this rejected as
  // a duplicate?" is a read of memory they cannot see.
  await assertWritableMemoryScope({ userId: input.owner, scope, workspaceId, projectId });

  const existing = await db.memory.findMany({
    where: {
      owner: input.owner,
      scope,
      projectId,
      ...(scope === "workspace" ? { workspaceId } : {}),
      archived: false,
      validTo: null,
    },
    select: { content: true },
    orderBy: { createdAt: "desc" },
    take: DUPLICATE_WINDOW,
  });

  const verdict = classifyForIngestion({
    content: input.content,
    speaker: input.speaker,
    source: input.source,
    projectId,
    existingContents: existing.map((row) => row.content),
    authoritativeSources: input.authoritativeSources,
  });

  const accepted = verdict.decision !== "DISCARD" && verdict.lane !== null;

  let memoryId: string | null = null;
  if (accepted && verdict.lane) {
    const memory = await db.memory.create({
      data: {
        type: memoryTypeForLane(verdict.lane),
        scope,
        owner: input.owner,
        content: input.content.replace(/\s+/g, " ").trim(),
        tags: input.tags ?? [],
        source: input.source ?? "ingestion",
        projectId,
        workspaceId,
        importanceScore: verdict.suggestedImportance,
        confidence: verdict.signals.confidence,
        provenanceClass: input.speaker === "user" ? "USER_PROVIDED" : "OBSERVED",
        eventTime: input.eventTime ?? null,
      },
    });
    memoryId = memory.id;
  }

  const decision = await db.memoryIngestionDecision.create({
    data: {
      decision: verdict.decision,
      lane: verdict.lane,
      accepted,
      // The gate rejects secret-shaped content before anything is written, so
      // a rejected secret is recorded as a decision without its content: the
      // audit trail must not become the place the secret ends up.
      content: verdict.signals.sensitivity === 1 ? "[redacted: secret-shaped content]" : input.content,
      reasons: verdict.reasons,
      signals: verdict.signals as unknown as object,
      expectedRetrievalValue: verdict.expectedRetrievalValue,
      needsModelReview: verdict.needsModelReview,
      owner: input.owner,
      projectId,
      workspaceId,
      source: input.source ?? null,
      speaker: input.speaker ?? null,
      memoryId,
    },
    select: { id: true },
  });

  // A correction is linked to what it corrects when it is stored, not when a
  // sweep next runs. Shadow by default, so this records the judgement without
  // acting on it unless configured otherwise.
  if (memoryId) {
    await reconsolidateMemory(memoryId, {
      mode: input.reconsolidationMode ?? defaultMode(),
      origin: "ingestion",
    }).catch(() => null);
  }

  return { accepted, memoryId, verdict, decisionId: decision.id };
}

/**
 * What the gate has been rejecting, and why.
 *
 * The point of recording rejections is to be able to see that the rules are
 * wrong. Without reading this back, selective persistence is an unfalsifiable
 * claim that the right things are being kept.
 */
export async function recentIngestionDecisions(options: {
  owner?: string;
  accepted?: boolean;
  limit?: number;
} = {}) {
  return db.memoryIngestionDecision.findMany({
    where: {
      ...(options.owner ? { owner: options.owner } : {}),
      ...(options.accepted === undefined ? {} : { accepted: options.accepted }),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(options.limit ?? 50, 500),
  });
}
