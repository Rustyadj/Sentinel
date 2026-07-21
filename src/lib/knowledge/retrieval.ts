// Knowledge Engine — server-enforced scoped context retrieval.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { RetrievalContext } from "./types";

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
  memories: Array<{ content: string; scope: string; tags: string[] }>;
  notes: Array<{ title: string; content: string; tags: string[] }>;
  decisions: Array<{ title: string; summary: string; status: string }>;
  totalItems: number;
}> {
  const maxItems = Math.min(Math.max(ctx.maxItems ?? 40, 1), 100);
  const filters = buildRetrievalFilters(ctx);
  const [memoriesRaw, notesRaw, decisionsRaw] = await Promise.all([
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
  ]);

  const memories = memoriesRaw.map((item) => ({
    content: item.content,
    scope: item.scope,
    tags: item.tags,
  }));
  const notes = notesRaw.map((item) => ({
    title: item.title,
    content: item.content,
    tags: item.tags,
  }));
  const decisions = decisionsRaw.map((item) => ({
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
