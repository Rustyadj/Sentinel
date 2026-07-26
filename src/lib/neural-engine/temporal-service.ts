// Sentinel Neural Engine — Temporal Graph (Layer 3)
//
// Every important object supports history via supersession, never deletion.
// A "logical" KnowledgeObject is a chain of physical rows linked by
// supersededByObjectId, each with a [validFrom, validTo) validity window.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { emitNeuralEvent } from "./event-service";

const MAX_CHAIN_HOPS = 100;

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

/**
 * Close out the current row and open a new one carrying the patch, linked by
 * supersession. The old row is never deleted or overwritten in place.
 */
export async function supersedeKnowledgeObject(
  currentId: string,
  patch: Partial<{
    title: string;
    summary: string | null;
    scope: string;
    metadata: Record<string, unknown>;
  }>,
  changedBy: string,
  changeReason: string,
  sourceEventId?: string,
) {
  const current = await db.knowledgeObject.findUniqueOrThrow({ where: { id: currentId } });
  if (current.validTo) {
    throw new Error(
      `KnowledgeObject ${currentId} is already superseded (validTo=${current.validTo.toISOString()}) — supersede its successor instead.`,
    );
  }

  const now = new Date();

  const [, next] = await db.$transaction([
    db.knowledgeObject.update({
      where: { id: currentId },
      data: { validTo: now },
    }),
    db.knowledgeObject.create({
      data: {
        type: current.type,
        title: patch.title ?? current.title,
        summary: patch.summary !== undefined ? patch.summary : current.summary,
        sourceType: current.sourceType,
        sourceId: current.sourceId,
        scope: patch.scope ?? current.scope,
        workspaceId: current.workspaceId,
        projectId: current.projectId,
        organizationId: current.organizationId,
        userId: current.userId,
        // Current-row uniqueness is enforced by a partial index, so the full
        // ownership and provenance chain can be preserved across supersession.
        metadata: toJson(patch.metadata ?? (current.metadata as Record<string, unknown>)),
        version: current.version + 1,
        validFrom: now,
        changeReason,
        changedBy,
        sourceEventId: sourceEventId ?? null,
      },
    }),
  ]);

  await db.knowledgeObject.update({
    where: { id: currentId },
    data: { supersededByObjectId: next.id },
  });

  await emitNeuralEvent({
    type: "object_updated",
    payload: { objectId: next.id, supersedes: currentId, changeReason },
    projectId: current.projectId,
    workspaceId: current.workspaceId,
  });

  return next;
}

/** Walk the full supersession chain (oldest -> newest) containing `anyIdInChain`. */
export async function getKnowledgeObjectChain(anyIdInChain: string) {
  let head = await db.knowledgeObject.findUniqueOrThrow({ where: { id: anyIdInChain } });

  // Walk backward to the root.
  let hops = 0;
  while (true) {
    const prior = await db.knowledgeObject.findFirst({
      where: { supersededByObjectId: head.id },
    });
    if (!prior || ++hops > MAX_CHAIN_HOPS) break;
    head = prior;
  }

  // Walk forward collecting the chain.
  const chain = [head];
  let cursor = head;
  hops = 0;
  while (cursor.supersededByObjectId && ++hops <= MAX_CHAIN_HOPS) {
    const next = await db.knowledgeObject.findUnique({
      where: { id: cursor.supersededByObjectId },
    });
    if (!next) break;
    chain.push(next);
    cursor = next;
  }

  return chain;
}

/** Resolve which row in a chain was valid at `timestamp` ("at timestamp" API). */
export async function getKnowledgeObjectAsOf(anyIdInChain: string, timestamp: Date) {
  const chain = await getKnowledgeObjectChain(anyIdInChain);
  return (
    chain.find(
      (row) => row.validFrom <= timestamp && (!row.validTo || row.validTo > timestamp),
    ) ?? null
  );
}

/** "now" API — every currently-valid object in scope. */
export async function listCurrentKnowledgeObjects(filter: {
  scope?: string;
  projectId?: string;
  type?: string;
} = {}) {
  return db.knowledgeObject.findMany({
    where: {
      validTo: null,
      ...(filter.scope ? { scope: filter.scope } : {}),
      ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

/** "between timestamps" API — anything valid at any point in [from, to]. */
export async function listKnowledgeObjectsBetween(from: Date, to: Date, filter: {
  scope?: string;
  projectId?: string;
} = {}) {
  return db.knowledgeObject.findMany({
    where: {
      validFrom: { lte: to },
      OR: [{ validTo: null }, { validTo: { gte: from } }],
      ...(filter.scope ? { scope: filter.scope } : {}),
      ...(filter.projectId !== undefined ? { projectId: filter.projectId } : {}),
    },
    orderBy: { validFrom: "asc" },
  });
}

/**
 * "at timestamp" API for the whole graph (Phase E) — a single query, not a
 * per-object chain walk. Every row valid at `timestamp` in one pass:
 * validFrom <= timestamp AND (validTo IS NULL OR validTo > timestamp). This
 * is what powers the Neural Lens timeline scrubber's non-"Now" ranges.
 *
 * Access control mirrors src/lib/knowledge/graph.ts's buildGraphData (own
 * objects OR objects in a readable project) — kept as explicit params rather
 * than importing the RBAC layer here, so temporal-service stays a plain data
 * layer and the access decision stays visible at the call site (the API route).
 */
export async function listKnowledgeObjectsAsOf(
  timestamp: Date,
  access: { userId: string; readableProjectIds: string[] },
  filter: { projectId?: string; workspaceId?: string; type?: string } = {},
) {
  return db.knowledgeObject.findMany({
    where: {
      validFrom: { lte: timestamp },
      OR: [{ validTo: null }, { validTo: { gt: timestamp } }],
      AND: [
        {
          OR: [
            { userId: access.userId },
            ...(access.readableProjectIds.length > 0
              ? [{ projectId: { in: access.readableProjectIds } }]
              : []),
          ],
        },
        ...(filter.projectId ? [{ projectId: filter.projectId }] : []),
      ],
      ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}),
      ...(filter.type ? { type: filter.type } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 250,
  });
}

/** Edges whose own validity window covers `timestamp`, restricted to a node set. */
export async function listKnowledgeEdgesAsOf(timestamp: Date, nodeIds: string[]) {
  if (nodeIds.length === 0) return [];
  return db.knowledgeEdge.findMany({
    where: {
      validFrom: { lte: timestamp },
      OR: [{ validTo: null }, { validTo: { gt: timestamp } }],
      fromObjectId: { in: nodeIds },
      toObjectId: { in: nodeIds },
    },
    orderBy: { createdAt: "desc" },
    take: 1000,
  });
}
