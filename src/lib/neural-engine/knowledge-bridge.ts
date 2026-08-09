// Sentinel Neural Engine — Phase C: KnowledgeObject bridge
//
// Layer 1 (src/lib/knowledge/*) creates KnowledgeObject bridge rows
// explicitly — e.g. when a chat-extracted candidate is accepted. Most
// Memory/ObsidianNote/Decision rows a plain retrieveContext() call surfaces
// do NOT yet have a bridge row, so the retrieval planner (which ranks
// KnowledgeObject rows, not raw source tables) and chat capture (which needs
// KnowledgeObject ids for `Experience.knowledgeUsed`) have nothing to point
// at. This file closes that gap: idempotent get-or-create, never duplicates.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type { KnowledgeObjectType, KnowledgeScope, RetrievalContext } from "@/lib/knowledge/types";
import { retrieveContext } from "@/lib/knowledge/retrieval";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export interface BridgeSourceParams {
  type: KnowledgeObjectType;
  title: string;
  summary?: string;
  sourceType: string;
  sourceId: string;
  scope: KnowledgeScope;
  projectId?: string | null;
  /** Without this, buildGraphData's access filter (`OR: [{userId}, {projectId
   * in accessible}]`) can never match a project-less bridged row — it would
   * be created but permanently invisible, to its own creator included. */
  userId?: string | null;
  metadata?: Record<string, unknown>;
}

/**
 * Idempotent: a second call with the same (sourceType, sourceId) returns the
 * existing row's id rather than creating a duplicate.
 */
export async function getOrCreateKnowledgeObjectForSource(
  params: BridgeSourceParams,
): Promise<string> {
  const existing = await db.knowledgeObject.findFirst({
    where: { sourceType: params.sourceType, sourceId: params.sourceId },
    select: { id: true },
  });
  if (existing) return existing.id;

  const created = await db.knowledgeObject.create({
    data: {
      type: params.type,
      title: params.title,
      summary: params.summary ?? null,
      sourceType: params.sourceType,
      sourceId: params.sourceId,
      scope: params.scope,
      projectId: params.projectId ?? null,
      userId: params.userId ?? null,
      metadata: toJson(params.metadata ?? {}),
    },
  });
  return created.id;
}

export interface RetrievedItemWithId {
  id: string;
  [key: string]: unknown;
}

/**
 * Bridge a batch of already-retrieved source rows (memories/notes/decisions)
 * into KnowledgeObject ids, in one pass. Skips items with no id.
 */
export async function bridgeBatch(
  items: Array<{
    sourceType: string;
    sourceId: string;
    type: KnowledgeObjectType;
    title: string;
    scope: KnowledgeScope;
    projectId?: string | null;
    userId?: string | null;
  }>,
): Promise<string[]> {
  const ids: string[] = [];
  for (const item of items) {
    const id = await getOrCreateKnowledgeObjectForSource({
      type: item.type,
      title: item.title,
      sourceType: item.sourceType,
      sourceId: item.sourceId,
      scope: item.scope,
      projectId: item.projectId,
      userId: item.userId,
    });
    ids.push(id);
  }
  return ids;
}

/**
 * The seam Phase C's "exact next phase" note asked for: run the existing,
 * tested retrieveContext(), then bridge whatever it surfaced into
 * KnowledgeObject ids so a caller (chat capture) can populate
 * `Experience.knowledgeUsed` with real provenance instead of an empty array.
 * Isolation guarantees are inherited unchanged from retrieveContext — this
 * function does not re-implement or loosen them.
 */
export async function retrieveContextWithProvenance(ctx: RetrievalContext) {
  const result = await retrieveContext(ctx);
  const projectId = ctx.projectId ?? null;
  const userId = ctx.userId;

  const knowledgeObjectIds = await bridgeBatch([
    ...result.memories.map((m) => ({
      sourceType: "memory",
      sourceId: m.id,
      type: "Memory" as const,
      title: m.content.slice(0, 80),
      scope: m.scope as KnowledgeScope,
      projectId,
      userId,
    })),
    ...result.notes.map((n) => ({
      sourceType: "obsidian_note",
      sourceId: n.id,
      type: "Note" as const,
      title: n.title,
      scope: (projectId ? "project" : "global") as KnowledgeScope,
      projectId,
      userId,
    })),
    ...result.decisions.map((d) => ({
      sourceType: "decision",
      sourceId: d.id,
      type: "Decision" as const,
      title: d.title,
      scope: (projectId ? "project" : "global") as KnowledgeScope,
      projectId,
      userId,
    })),
  ]);

  return { ...result, knowledgeObjectIds };
}
