// Knowledge Engine — server-enforced scoped context retrieval.

import { db } from "@/lib/db";
import { redisGet, redisSet } from "@/lib/redis";
import type { Prisma } from "@prisma/client";
import type { RetrievalContext } from "./types";

const SESSION_MEMORY_TTL_SECONDS = 6 * 60 * 60; // 6 hours
const SESSION_MEMORY_MAX_TURNS = 20;

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

  if (ctx.projectId) {
    return {
      memory: includeUserContext
        ? {
            owner: ctx.userId,
            archived: false,
            OR: [
              { scope: "project", projectId: ctx.projectId },
              { scope: { in: ["user", "global"] }, projectId: null },
            ],
          }
        : {
            owner: ctx.userId,
            archived: false,
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
      scope: { in: ["user", "global"] },
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
  memories: Array<{ id: string; content: string; scope: string; tags: string[] }>;
  notes: Array<{ id: string; title: string; content: string; tags: string[] }>;
  decisions: Array<{ id: string; title: string; summary: string; status: string }>;
  totalItems: number;
}> {
  const maxItems = Math.min(Math.max(ctx.maxItems ?? 40, 1), 100);
  const filters = buildRetrievalFilters(ctx);
  const [memoriesRaw, notesRaw, decisionsRaw, sessionMemories] = await Promise.all([
    db.memory.findMany({
      where: filters.memory,
      orderBy: [{ pinned: "desc" }, { importanceScore: "desc" }, { createdAt: "desc" }],
      take: maxItems,
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

  const memories = [
    ...sessionMemories,
    ...memoriesRaw.map((item) => ({
      id: item.id,
      content: item.content,
      scope: item.scope,
      tags: item.tags,
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
