// Knowledge Engine — the one shared write path from a domain-model row to a
// real, persisted graph node. Replaces the old pattern (still in graph.ts's
// bridgeAgent/bridgeChatRoom callers) of synthesizing ephemeral nodes fresh
// on every /api/graph read. Call this from a model's own create/update path
// — idempotent, safe to call on every write.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import type {
  KnowledgeObjectType,
  KnowledgeScope,
  KnowledgeEdgeType,
  KnowledgeNode,
} from "./types";
import { toKnowledgeNode } from "./objects";
import { upsertEdge } from "./edges";
import { emitEvent } from "./events";

function toInputJson(value: Record<string, unknown>): Prisma.InputJsonValue {
  return value as unknown as Prisma.InputJsonValue;
}

export interface GraphEdgeSpec {
  toSourceType: string;
  toSourceId: string;
  type: KnowledgeEdgeType;
  weight?: number;
  metadata?: Record<string, unknown>;
}

export interface SyncToGraphParams {
  sourceType: string; // e.g. "agent", "chat_room" — matches KnowledgeObject.sourceType convention
  sourceId: string;
  type: KnowledgeObjectType;
  title: string;
  summary?: string;
  scope?: KnowledgeScope;
  projectId?: string;
  workspaceId?: string;
  organizationId?: string;
  metadata?: Record<string, unknown>;
  // Edges FROM this node TO other nodes already synced into the graph,
  // looked up by their own (sourceType, sourceId). Targets that don't exist
  // yet are skipped, not treated as an error — sync order between related
  // models isn't guaranteed.
  edges?: GraphEdgeSpec[];
}

export async function syncToGraph(params: SyncToGraphParams): Promise<KnowledgeNode> {
  const existing = await db.knowledgeObject.findFirst({
    where: { sourceType: params.sourceType, sourceId: params.sourceId },
  });

  const data = {
    type: params.type,
    title: params.title,
    summary: params.summary ?? null,
    scope: params.scope ?? "global",
    projectId: params.projectId ?? null,
    workspaceId: params.workspaceId ?? null,
    organizationId: params.organizationId ?? null,
    metadata: toInputJson(params.metadata ?? {}),
  };

  const record = existing
    ? await db.knowledgeObject.update({ where: { id: existing.id }, data })
    : await db.knowledgeObject.create({
        data: {
          id: `${params.sourceType}:${params.sourceId}`,
          sourceType: params.sourceType,
          sourceId: params.sourceId,
          ...data,
        },
      });

  // Event logging is observability, not correctness — never let it fail the sync.
  await emitEvent({
    type: existing ? "object_updated" : "object_created",
    payload: { knowledgeObjectId: record.id, sourceType: params.sourceType, sourceId: params.sourceId },
    ...(params.projectId ? { projectId: params.projectId } : {}),
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
  }).catch(() => {});

  if (params.edges?.length) {
    for (const edgeSpec of params.edges) {
      const target = await db.knowledgeObject.findFirst({
        where: { sourceType: edgeSpec.toSourceType, sourceId: edgeSpec.toSourceId },
      });
      if (!target) continue;
      await upsertEdge({
        fromObjectId: record.id,
        toObjectId: target.id,
        type: edgeSpec.type,
        weight: edgeSpec.weight,
        metadata: edgeSpec.metadata,
      }).catch(() => {});
    }
  }

  return toKnowledgeNode(record);
}

/** Removes a node (and its edges, via DB cascade) when the source row is deleted. */
export async function removeFromGraph(sourceType: string, sourceId: string): Promise<void> {
  const existing = await db.knowledgeObject.findFirst({
    where: { sourceType, sourceId },
  });
  if (!existing) return;
  await db.knowledgeObject.delete({ where: { id: existing.id } });
}
