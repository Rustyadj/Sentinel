// Knowledge Engine — graph snapshot builder

import { db } from "@/lib/db";
import { bridgeMemory, toKnowledgeNode } from "./objects";
import type {
  KnowledgeObjectType,
  KnowledgeScope,
  KnowledgeNode,
  KnowledgeEdge,
  KnowledgeEdgeType,
  GraphData,
} from "./types";

function toKnowledgeEdge(record: {
  id: string;
  fromObjectId: string;
  toObjectId: string;
  type: string;
  weight: number;
  metadata: unknown;
}): KnowledgeEdge {
  return {
    id: record.id,
    fromObjectId: record.fromObjectId,
    toObjectId: record.toObjectId,
    type: record.type as KnowledgeEdgeType,
    weight: record.weight,
    metadata: (record.metadata as Record<string, unknown>) ?? {},
  };
}

export async function buildGraphData(filter: {
  projectId?: string;
  workspaceId?: string;
  roomId?: string;
  sourceType?: string;
  sourceId?: string;
  includeTypes?: KnowledgeObjectType[];
}): Promise<GraphData> {
  try {
    const hasSourceRoot = filter.sourceType !== undefined && filter.sourceId !== undefined;
    let neighborhoodIds: string[] | null = null;

    if (hasSourceRoot) {
      const root = await db.knowledgeObject.findFirst({
        where: { sourceType: filter.sourceType, sourceId: filter.sourceId },
        select: { id: true },
      });

      if (!root) {
        neighborhoodIds = [];
      } else {
        // Cluster Mode is intentionally a one-hop neighborhood for Phase 3:
        // the selected source root plus every directly connected object. The
        // final edge query below then includes all relationships among that
        // bounded node set, without pulling unrelated global-scope objects in.
        const incidentEdges = await db.knowledgeEdge.findMany({
          where: {
            OR: [{ fromObjectId: root.id }, { toObjectId: root.id }],
          },
          select: { fromObjectId: true, toObjectId: true },
        });
        const ids = new Set<string>([root.id]);
        for (const edge of incidentEdges) {
          ids.add(edge.fromObjectId);
          ids.add(edge.toObjectId);
        }
        neighborhoodIds = [...ids];
      }
    }

    // 1. Fetch KnowledgeObjects. Global-scope nodes (e.g. Agents — a
    // control-plane concept, not project-scoped) are always included
    // alongside whatever projectId/workspaceId/roomId filter is active, so a
    // scoped view doesn't lose the agents operating in it. A roomId filter
    // also explicitly pulls in that room's own node even if it falls outside
    // the projectId/workspaceId match.
    const scopeFilter = neighborhoodIds
      ? { id: { in: neighborhoodIds } }
      : filter.projectId !== undefined || filter.workspaceId !== undefined || filter.roomId
        ? {
            OR: [
              {
                ...(filter.projectId !== undefined
                  ? { projectId: filter.projectId }
                  : {}),
                ...(filter.workspaceId !== undefined
                  ? { workspaceId: filter.workspaceId }
                  : {}),
              },
              { scope: "global" as const },
              ...(filter.roomId
                ? [{ sourceType: "chat_room", sourceId: filter.roomId }]
                : []),
            ],
          }
        : {};

    const objectRecords = await db.knowledgeObject.findMany({
      where: {
        ...scopeFilter,
        ...(filter.includeTypes && filter.includeTypes.length > 0
          ? { type: { in: filter.includeTypes } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    const storedNodes: KnowledgeNode[] = objectRecords.map(toKnowledgeNode);
    const storedNodeIds = new Set(storedNodes.map((n) => n.id));

    // 2. Fetch edges. Root neighborhoods are closed over the selected node
    // set; legacy scope views retain their existing either-side behavior.
    const edgeRecords = await db.knowledgeEdge.findMany({
      where: neighborhoodIds
        ? {
            AND: [
              { fromObjectId: { in: [...storedNodeIds] } },
              { toObjectId: { in: [...storedNodeIds] } },
            ],
          }
        : {
            OR: [
              { fromObjectId: { in: [...storedNodeIds] } },
              { toObjectId: { in: [...storedNodeIds] } },
            ],
          },
    });

    const edges: KnowledgeEdge[] = edgeRecords.map(toKnowledgeEdge);

    // 3. Bridge virtual nodes from existing records
    const virtualNodes: KnowledgeNode[] = [];

    // Bridge Memory records
    const memoryRecords = neighborhoodIds
      ? []
      : await db.memory.findMany({
          where: filter.projectId
            ? { scope: "project" }
            : { scope: { in: ["global", "user", "workspace"] } },
          take: 50,
          orderBy: { createdAt: "desc" },
        });
    for (const m of memoryRecords) {
      virtualNodes.push(
        bridgeMemory({
          id: m.id,
          content: m.content,
          type: m.type,
          scope: m.scope,
          owner: m.owner,
          tags: m.tags,
          createdAt: m.createdAt,
        })
      );
    }

    // Agent and ChatRoom nodes are no longer synthesized here — they're real,
    // persisted KnowledgeObject rows (see src/lib/knowledge/sync.ts, wired
    // into Agent's seed/create/update/delete paths and the /api/rooms create
    // path), already picked up by the stored-object query above via the
    // global-scope OR clause / roomId sourceId match.

    // Deduplicate nodes (prefer stored over virtual)
    const nodeMap = new Map<string, KnowledgeNode>();
    for (const n of storedNodes) nodeMap.set(n.id, n);
    for (const n of virtualNodes) {
      if (!nodeMap.has(n.id)) nodeMap.set(n.id, n);
    }

    return {
      nodes: Array.from(nodeMap.values()),
      edges,
    };
  } catch (err) {
    throw new Error(
      `buildGraphData failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
