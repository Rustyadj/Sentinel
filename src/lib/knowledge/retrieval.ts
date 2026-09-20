// Knowledge Engine — server-enforced scoped context retrieval.

import { db } from "@/lib/db";
import { redisGet, redisSet } from "@/lib/redis";
import type { Prisma } from "@prisma/client";
import type { RetrievalContext } from "./types";
import { excludeFromRetrieval } from "@/lib/learning/memory-governance";
import { rankMemories, type RankedMemory } from "./retrieval-ranking";
import { classifyTemporalIntent } from "./temporal-intent";

const SESSION_MEMORY_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const SESSION_MEMORY_MAX_TURNS = 20;

/** How many in-scope memories to score before trimming to the caller's budget.
 *  Large enough that a relevant memory is not excluded by value ordering
 *  before ranking ever sees it -- the failure the benchmark exposed. */
const CANDIDATE_POOL_SIZE = 200;

function sessionMemoryKey(roomId: string): string {
  return `session:${roomId}:memory`;
}

interface SessionTurn {
  role: string;
  content: string;
}

// Append a turn to a room's ephemeral Redis-backed session memory, capped to
// the last SESSION_MEMORY_MAX_TURNS turns and expiring after
// SESSION_MEMORY_TTL_SECONDS of inactivity. Best-effort: Redis is optional
// (see @/lib/redis), so failures here never throw into the chat path.
export async function appendSessionMemory(
  roomId: string,
  turns: SessionTurn[]
): Promise<void> {
  const key = sessionMemoryKey(roomId);
  const existingRaw = await redisGet(key);
  const existing: SessionTurn[] = existingRaw ? JSON.parse(existingRaw) : [];
  const updated = [...existing, ...turns].slice(-SESSION_MEMORY_MAX_TURNS);
  await redisSet(key, JSON.stringify(updated), SESSION_MEMORY_TTL_SECONDS);
}

// roomId is caller-validated (the chat route only ever passes a roomId it has
// already confirmed belongs to the requesting user), so keying purely by
// roomId here does not widen access beyond what buildRetrievalFilters enforces
// for the DB-backed memories below.
async function retrieveSessionMemory(
  roomId?: string
): Promise<Array<{ id: string; content: string; scope: string; tags: string[] }>> {
  if (!roomId) return [];
  const raw = await redisGet(sessionMemoryKey(roomId));
  if (!raw) return [];
  try {
    const turns: SessionTurn[] = JSON.parse(raw);
    return turns.map((t, i) => ({
      id: `session:${roomId}:${i}`,
      content: `${t.role}: ${t.content}`,
      scope: "session",
      tags: [],
    }));
  } catch {
    return [];
  }
}

export function buildRetrievalFilters(ctx: RetrievalContext): {
  memory: Prisma.MemoryWhereInput;
  note: Prisma.ObsidianNoteWhereInput;
  decision: Prisma.DecisionWhereInput;
} {
  const includeUserContext = ctx.scopePolicy === "user-context";

  // Quarantined/forgotten memories are governance states, not a retrieval
  // scope — excluded from every branch below regardless of project/user
  // context (see src/lib/learning/memory-governance.ts).
  //
  // Supersession is different, and is the one part of this that depends on the
  // question. A corrected belief must not come back as current truth, but
  // "what were we using before the switch?" is only answerable from exactly
  // those rows. classifyTemporalIntent decides, conservatively: anything not
  // explicitly asking about the past is treated as asking about now.
  const temporal = classifyTemporalIntent(ctx.query);
  const notForgottenOrQuarantined = excludeFromRetrieval({ temporalIntent: temporal.intent });

  if (ctx.projectId) {
    return {
      memory: includeUserContext
        ? {
            owner: ctx.userId,
            archived: false,
            ...notForgottenOrQuarantined,
            OR: [
              { scope: "project", projectId: ctx.projectId },
              // "workspace" was missing here, so workspace-scoped memories
              // were unreachable from every surface -- the benchmark scored
              // workspace recall at 0.000 for exactly this reason. Memory has
              // no workspaceId column, so a workspace-scoped row is isolated
              // by `owner` like user/global rows are; it is no broader than
              // what this branch already returns. Genuine per-workspace
              // isolation needs a column and is tracked separately.
              { scope: { in: ["workspace", "organization", "user", "global"] }, projectId: null },
            ],
          }
        : {
            owner: ctx.userId,
            archived: false,
            ...notForgottenOrQuarantined,
            scope: "project",
            projectId: ctx.projectId,
          },
      note: { projectId: ctx.projectId },
      decision: { projectId: ctx.projectId, status: { in: ["approved", "proposed"] } },
    };
  }

  return {
    memory: {
      owner: ctx.userId,
      archived: false,
      projectId: null,
      scope: { in: ["workspace", "organization", "user", "global"] },
      ...notForgottenOrQuarantined,
    },
    note: { projectId: null, userId: ctx.userId },
    decision: {
      projectId: null,
      userId: ctx.userId,
      status: { in: ["approved", "proposed"] },
    },
  };
}

export async function retrieveContext(ctx: RetrievalContext): Promise<{
  memories: Array<{
    id: string;
    content: string;
    scope: string;
    tags: string[];
    retrievalScore?: number;
    retrievalFactors?: RankedMemory["factors"];
  }>;
  notes: Array<{ id: string; title: string; content: string; tags: string[] }>;
  decisions: Array<{ id: string; title: string; summary: string; status: string }>;
  totalItems: number;
}> {
  const maxItems = Math.min(Math.max(ctx.maxItems ?? 40, 1), 100);
  const filters = buildRetrievalFilters(ctx);
  // With a query we score a wider pool and let ranking choose; without one we
  // keep the original value-ordered top-N exactly as it was.
  const query = (ctx.query ?? "").trim();
  // Recomputed rather than threaded out of buildRetrievalFilters, which is a
  // pure where-clause builder and is called on its own elsewhere.
  // classifyTemporalIntent is a pure regex match over the same string, so the
  // two cannot disagree.
  const temporal = classifyTemporalIntent(ctx.query);
  const poolSize = query ? Math.max(maxItems, CANDIDATE_POOL_SIZE) : maxItems;

  const [memoriesRaw, notesRaw, decisionsRaw, sessionMemories] = await Promise.all([
    db.memory.findMany({
      where: filters.memory,
      // valueScore is the decay policy's output. Ranking by it is what makes
      // decay mean anything at retrieval time: without this, a memory could be
      // scored down every night and still occupy the same slot in every prompt.
      // Nulls sort last, so memories the sweep has not yet scored fall behind
      // scored ones rather than jumping the queue. Pinned still wins outright —
      // it is an explicit human override.
      orderBy: [
        { pinned: "desc" },
        { valueScore: { sort: "desc", nulls: "last" } },
        { importanceScore: "desc" },
        { createdAt: "desc" },
      ],
      take: poolSize,
    }),
    db.obsidianNote.findMany({
      where: filters.note,
      orderBy: { createdAt: "desc" },
      take: Math.max(1, Math.floor(maxItems / 2)),
    }),
    db.decision.findMany({
      where: filters.decision,
      orderBy: { createdAt: "desc" },
      take: Math.min(10, maxItems),
    }),
    retrieveSessionMemory(ctx.roomId),
  ]);

  const ranked: RankedMemory<(typeof memoriesRaw)[number]>[] = query
    ? rankMemories(query, memoriesRaw, {
        limit: maxItems,
        temporalIntent: temporal.intent,
        asOf: temporal.asOf,
      })
    : memoriesRaw.slice(0, maxItems).map((memory) => ({ memory, score: 0, factors: [] }));

  const memories = [
    ...sessionMemories,
    ...ranked.map((entry) => ({
      id: entry.memory.id,
      content: entry.memory.content,
      scope: entry.memory.scope,
      tags: entry.memory.tags,
      // Why this memory is here, and why it outranked the ones that are not.
      retrievalScore: entry.score,
      retrievalFactors: entry.factors,
    })),
  ];
  const notes = notesRaw.map((item) => ({
    id: item.id,
    title: item.title,
    content: item.content,
    tags: item.tags,
  }));
  const decisions = decisionsRaw.map((item) => ({
    id: item.id,
    title: item.title,
    summary: item.summary,
    status: item.status,
  }));

  return {
    memories,
    notes,
    decisions,
    totalItems: memories.length + notes.length + decisions.length,
  };
}
