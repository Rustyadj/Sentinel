// Sentinel — bitemporal history for Memory.
//
// KnowledgeObject, KnowledgeEdge and Decision have carried validFrom/validTo/
// supersededBy since the temporal graph landed, so "what did we believe at time
// X" was already answerable for the graph — but not for memories themselves.
// This closes that asymmetry using the same pattern rather than a second
// temporal system: close the current row, open a successor, link them, and
// never mutate history in place.

import { db } from "@/lib/db";
import { emitNeuralEvent } from "./event-service";

export interface MemoryPatch {
  content?: string;
  confidence?: number;
  importanceScore?: number;
  tags?: string[];
  state?: string;
  provenanceClass?: string;
  shadowOnly?: boolean;
}

/**
 * Close out the current memory and open a successor carrying the patch.
 *
 * The prior row keeps its content verbatim and gains `validTo` plus
 * `supersededById`. Nothing is overwritten, so a belief that later turns out to
 * be wrong stays readable exactly as it was held.
 */
export async function supersedeMemory(
  currentId: string,
  patch: MemoryPatch,
  changeReason: string,
) {
  const current = await db.memory.findUniqueOrThrow({ where: { id: currentId } });
  if (current.validTo) {
    throw new Error(
      `Memory ${currentId} is already superseded (validTo=${current.validTo.toISOString()}) — supersede its successor instead.`,
    );
  }

  const now = new Date();

  const [, next] = await db.$transaction([
    db.memory.update({ where: { id: currentId }, data: { validTo: now } }),
    db.memory.create({
      data: {
        type: current.type,
        scope: current.scope,
        owner: current.owner,
        content: patch.content ?? current.content,
        tags: patch.tags ?? current.tags,
        confidence: patch.confidence ?? current.confidence,
        importanceScore: patch.importanceScore ?? current.importanceScore,
        source: current.source,
        projectId: current.projectId,
        provenanceClass: patch.provenanceClass ?? current.provenanceClass,
        provenanceTrust: current.provenanceTrust,
        shadowOnly: patch.shadowOnly ?? current.shadowOnly,
        derivedFromExperienceIds: current.derivedFromExperienceIds,
        // Evidence counts carry forward: superseding a belief does not erase
        // the record of how much support it had accumulated.
        confirmationCount: current.confirmationCount,
        disconfirmationCount: current.disconfirmationCount,
        contradictionCount: current.contradictionCount,
        state: patch.state ?? current.state,
        version: current.version + 1,
        validFrom: now,
        changeReason,
      },
    }),
  ]);

  await db.memory.update({ where: { id: currentId }, data: { supersededById: next.id } });

  await emitNeuralEvent({
    type: "memory.superseded",
    payload: { memoryId: next.id, supersedes: currentId, changeReason },
    projectId: current.projectId,
  }).catch(() => undefined);

  return next;
}

/** Walk the full supersession chain (oldest → newest) containing `anyIdInChain`. */
export async function getMemoryChain(anyIdInChain: string) {
  let oldest = await db.memory.findUniqueOrThrow({ where: { id: anyIdInChain } });
  // Walk backwards to the head of the chain.
  for (;;) {
    const previous = await db.memory.findFirst({ where: { supersededById: oldest.id } });
    if (!previous) break;
    oldest = previous;
  }

  const chain = [oldest];
  let cursor = oldest;
  while (cursor.supersededById) {
    const next = await db.memory.findUnique({ where: { id: cursor.supersededById } });
    if (!next) break;
    chain.push(next);
    cursor = next;
  }
  return chain;
}

/** What this memory said at `timestamp`, or null if it did not yet exist. */
export async function getMemoryAsOf(anyIdInChain: string, timestamp: Date) {
  const chain = await getMemoryChain(anyIdInChain);
  return (
    chain.find((row) => row.validFrom <= timestamp && (!row.validTo || row.validTo > timestamp)) ?? null
  );
}

/**
 * "What do we believe now?" — only rows that have not been superseded.
 * Pairs with listMemoriesAsOf for "what did we believe at time X?".
 */
export async function listCurrentMemories(filter: { owner?: string; projectId?: string | null } = {}) {
  return db.memory.findMany({
    where: {
      validTo: null,
      ...(filter.owner ? { owner: filter.owner } : {}),
      ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}),
    },
  });
}

/** Every memory row valid at `timestamp`, in one pass rather than per-chain walks. */
export async function listMemoriesAsOf(timestamp: Date, filter: { owner?: string; projectId?: string | null } = {}) {
  return db.memory.findMany({
    where: {
      validFrom: { lte: timestamp },
      OR: [{ validTo: null }, { validTo: { gt: timestamp } }],
      ...(filter.owner ? { owner: filter.owner } : {}),
      ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}),
    },
  });
}
