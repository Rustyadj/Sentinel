// Sentinel — memory usage recording.
//
// Two facts are deliberately kept apart here:
//
//   "this memory was retrieved"  — recorded at retrieval time, always
//   "this memory was useful"     — recorded only once the surrounding work has
//                                  been evaluated, and only when it succeeded
//
// Conflating them is what made the existing decay policy meaningless: with
// `lastUsefulAt` never written, staleness collapsed to age-since-last-write and
// eight of the nine net-value inputs contributed nothing. Retrieval frequency
// alone must never be able to keep a memory alive forever.

import { db } from "@/lib/db";
import { provenanceTrustFor } from "./memory-provenance";
import type { InjectedMemoryRecord } from "./context-assembly";

export interface RecordRetrievalInput {
  /** Every memory the retrieval surfaced, injected or not. */
  memoryIds: string[];
  /**
   * The subset that actually reached the worker's prompt, with the position
   * and token cost it occupied. Anything retrieved but absent from this list
   * is recorded as retrieved-only and can never count as outcome evidence.
   */
  injected?: InjectedMemoryRecord[];
  /** Which surface consumed this — "chat", "orchestration", "mcp". */
  consumer?: string | null;
  userId?: string | null;
  projectId?: string | null;
  workspaceId?: string | null;
  experienceId?: string | null;
  runId?: string | null;
}

/**
 * Record that these memories were placed in front of a worker. Deliberately
 * cheap and best-effort: retrieval is on the request path, and failing to log
 * usage must never fail the retrieval itself.
 *
 * Note what this does NOT write: `lastUsefulAt`. Being fetched is not evidence
 * of usefulness.
 */
export async function recordMemoryRetrieval(input: RecordRetrievalInput): Promise<number> {
  const memoryIds = [...new Set(input.memoryIds.filter(Boolean))];
  if (!memoryIds.length) return 0;

  const injectedById = new Map((input.injected ?? []).map((record) => [record.memoryId, record]));

  try {
    await db.$transaction([
      db.memoryRetrieval.createMany({
        data: memoryIds.map((memoryId) => {
          const injection = injectedById.get(memoryId);
          return {
            memoryId,
            injected: injection !== undefined,
            injectedRank: injection?.rank ?? null,
            contextTokens: injection?.estimatedTokens ?? null,
            consumer: input.consumer ?? null,
            userId: input.userId ?? null,
            projectId: input.projectId ?? null,
            workspaceId: input.workspaceId ?? null,
            experienceId: input.experienceId ?? null,
            runId: input.runId ?? null,
          };
        }),
      }),
      db.memory.updateMany({
        where: { id: { in: memoryIds } },
        data: { lastRetrievedAt: new Date(), retrievalCount: { increment: 1 } },
      }),
    ]);
    return memoryIds.length;
  } catch {
    return 0;
  }
}

/**
 * Backfill `provenanceTrust` from a memory's provenance class.
 *
 * This is a real signal rather than an invented one: it is a restatement of
 * where the memory came from, which Sentinel already records. It is idempotent,
 * so the consolidation cycle can keep it current as classes change.
 */
export async function syncProvenanceTrust(limit = 500): Promise<number> {
  const memories = await db.memory.findMany({
    where: { provenanceTrust: null },
    select: { id: true, provenanceClass: true },
    take: Math.min(Math.max(limit, 1), 2000),
  });

  let updated = 0;
  for (const memory of memories) {
    await db.memory.update({
      where: { id: memory.id },
      data: { provenanceTrust: provenanceTrustFor(memory.provenanceClass) },
    });
    updated += 1;
  }
  return updated;
}
