// Knowledge Engine — server-enforced scoped context retrieval.

import { db } from "@/lib/db";
import { redisGet, redisSet } from "@/lib/redis";
import type { Prisma } from "@prisma/client";
import type { RetrievalContext } from "./types";
import { excludeFromRetrieval } from "@/lib/learning/memory-governance";
import { rankMemories, type RankedMemory } from "./retrieval-ranking";
import { classifyTemporalIntent, orderingCue, effectiveEventTime } from "./temporal-intent";
import { resolveMemoryScopeAccess, type MemoryScopeAccess } from "./memory-scope";
import { verificationNeed, verificationNotice } from "./verification";

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

export function buildRetrievalFilters(
  ctx: RetrievalContext,
  /**
   * Workspaces this user is authorised to read memory from, already resolved
   * against the permission system (see memory-scope.ts). Passed in rather than
   * looked up here so this stays a pure where-clause builder.
   *
   * Omitted means "no workspace access resolved", and the workspace branch
   * then matches nothing. That is the safe default: a caller that forgets to
   * resolve access gets less, never more.
   */
  access?: MemoryScopeAccess,
): {
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

  // Workspace-scoped memory is the one branch that is NOT owner-isolated, and
  // that is the whole point of giving Memory a workspaceId: a workspace its
  // members share is meant to be shared. Access comes from the resolved
  // permission set, never from an id the caller supplied — and an empty set
  // matches nothing rather than everything, so a caller that failed to resolve
  // access, or asked about a workspace it may not read, sees no workspace
  // memory at all.
  //
  // `workspaceId: { in: [...] }` also excludes the legacy rows whose workspace
  // could not be derived (null). Unresolved is unreachable, not global.
  const workspaceIds = access?.workspaceIds ?? [];
  const workspaceBranch: Prisma.MemoryWhereInput[] = workspaceIds.length
    ? [{ scope: "workspace", workspaceId: { in: workspaceIds } }]
    : [];

  // Project, organization, user and global memory stay owner-isolated, exactly
  // as before. Widening those is a separate decision with its own blast
  // radius, and nothing here needs it.
  const ownedScopes = (scopes: string[], projectId: string | null): Prisma.MemoryWhereInput => ({
    owner: ctx.userId,
    scope: { in: scopes },
    projectId,
  });

  if (ctx.projectId) {
    return {
      memory: includeUserContext
        ? {
            archived: false,
            ...notForgottenOrQuarantined,
            OR: [
              { owner: ctx.userId, scope: "project", projectId: ctx.projectId },
              ownedScopes(["organization", "user", "global"], null),
              ...workspaceBranch,
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
      archived: false,
      ...notForgottenOrQuarantined,
      OR: [ownedScopes(["organization", "user", "global"], null), ...workspaceBranch],
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
    /** Set when this memory should be checked against its source before use. */
    verification?: string | null;
  }>;
  notes: Array<{ id: string; title: string; content: string; tags: string[] }>;
  decisions: Array<{ id: string; title: string; summary: string; status: string }>;
  totalItems: number;
}> {
  const maxItems = Math.min(Math.max(ctx.maxItems ?? 40, 1), 100);
  // Resolved before the query, against the permission system — never inferred
  // from the workspaceId the caller handed us. Knowing a workspace id confers
  // no access; an unauthorised one narrows the result to nothing.
  const access = await resolveMemoryScopeAccess(ctx.userId, ctx.workspaceId ?? null);
  const filters = buildRetrievalFilters(ctx, access);
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

  let ranked: RankedMemory<(typeof memoriesRaw)[number]>[] = query
    ? rankMemories(query, memoriesRaw, {
        limit: maxItems,
        temporalIntent: temporal.intent,
        asOf: temporal.asOf,
      })
    : memoriesRaw.slice(0, maxItems).map((memory) => ({ memory, score: 0, factors: [] }));

  // "Walk me through the rollout in order" wants a sequence, not a ranking.
  //
  // Ranking still chooses *which* memories answer the question -- reordering
  // the candidate pool by time would answer a different question with whatever
  // happened to be oldest. Only the chosen set is resequenced, by the time the
  // memory is about rather than by when the row was written: a rollout
  // recalled a week later inserts in the order it was recalled.
  const ordering = query ? orderingCue(query) : null;
  if (ordering) {
    // Only the memories that can *be* a sequence are sequenced. A first pass
    // sorted the whole result set by time, which scored the ordering perfectly
    // and cost MRR (0.870 -> 0.848): the oldest memory in the set was a
    // standing configuration fact, so "walk me through the rollout" answered
    // with that first and the rollout second. A question about what happened
    // is answered by the events; everything else keeps its ranked position
    // behind them.
    const isEvent = (memory: (typeof memoriesRaw)[number]) =>
      memory.eventTime != null || memory.type === "episodic";
    const events = ranked.filter((entry) => isEvent(entry.memory));
    const rest = ranked.filter((entry) => !isEvent(entry.memory));
    events.sort((a, b) => {
      const difference = effectiveEventTime(a.memory).getTime() - effectiveEventTime(b.memory).getTime();
      return difference !== 0 ? difference : b.score - a.score;
    });
    ranked = [...events, ...rest];
  }

  const memories = [
    ...sessionMemories,
    ...ranked.map((entry) => ({
      id: entry.memory.id,
      content: entry.memory.content,
      scope: entry.memory.scope,
      tags: entry.memory.tags,
      // Why this memory is here, and why it outranked the ones that are not.
      // A volatile fact that has gone unverified is still returned -- knowing
      // what a price was in March is useful -- but it is returned marked, so a
      // caller that can reach the authoritative source checks it rather than
      // trusting the memory.
      verification: verificationNotice(verificationNeed(entry.memory)),
      retrievalScore: entry.score,
      retrievalFactors: ordering
        ? [...entry.factors, { name: "chronological_order", weight: 0, score: 0, detail: `resequenced by event time (${ordering})` }]
        : entry.factors,
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
