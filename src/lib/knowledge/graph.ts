// Knowledge Engine — graph snapshot builder

import { db } from "@/lib/db";
import { bridgeMemory, bridgeAgent, bridgeChatRoom, toKnowledgeNode } from "./objects";
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
  includeTypes?: KnowledgeObjectType[];
}): Promise<GraphData> {
  try {
    // 1. Fetch KnowledgeObjects
    const objectRecords = await db.knowledgeObject.findMany({
      where: {
        ...(filter.projectId !== undefined
          ? { projectId: filter.projectId }
          : {}),
        ...(filter.workspaceId !== undefined
          ? { workspaceId: filter.workspaceId }
          : {}),
        ...(filter.includeTypes && filter.includeTypes.length > 0
          ? { type: { in: filter.includeTypes } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
    });

    const storedNodes: KnowledgeNode[] = objectRecords.map(toKnowledgeNode);
    const storedNodeIds = new Set(storedNodes.map((n) => n.id));

    // 2. Fetch edges where either side is in the node set
    const edgeRecords = await db.knowledgeEdge.findMany({
      where: {
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
    const memoryRecords = await db.memory.findMany({
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

    // Bridge Agent records
    const agentRecords = await db.agent.findMany({
      orderBy: { createdAt: "desc" },
      take: 30,
    });
    for (const a of agentRecords) {
      virtualNodes.push(
        bridgeAgent({
          id: a.id,
          name: a.name,
          role: a.role,
          status: a.status,
          createdAt: a.createdAt,
        })
      );
    }

    // Bridge ChatRoom — scoped to roomId if provided, otherwise use projectId
    if (filter.roomId) {
      const room = await db.chatRoom.findUnique({
        where: { id: filter.roomId },
      });
      if (room) {
        virtualNodes.push(
          bridgeChatRoom({
            id: room.id,
            name: room.name,
            projectId: room.projectId,
            createdAt: room.createdAt,
          })
        );
        // Synthesize agent nodes linked to this room
        if (room.agentIds && room.agentIds.length > 0) {
          const roomAgents = await db.agent.findMany({
            where: { id: { in: room.agentIds } },
          });
          for (const a of roomAgents) {
            if (!virtualNodes.find((n) => n.id === `agent:${a.id}`)) {
              virtualNodes.push(
                bridgeAgent({
                  id: a.id,
                  name: a.name,
                  role: a.role,
                  status: a.status,
                  createdAt: a.createdAt,
                })
              );
            }
          }
        }
      }
    } else if (filter.projectId) {
      const rooms = await db.chatRoom.findMany({
        where: { projectId: filter.projectId },
        take: 20,
        orderBy: { createdAt: "desc" },
      });
      for (const room of rooms) {
        virtualNodes.push(
          bridgeChatRoom({
            id: room.id,
            name: room.name,
            projectId: room.projectId,
            createdAt: room.createdAt,
          })
        );
      }
    }

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
