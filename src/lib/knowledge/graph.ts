// Knowledge Engine — authenticated graph snapshot builder

import { db } from "@/lib/db";
import { toKnowledgeNode } from "./objects";
import type {
  GraphData,
  KnowledgeEdge,
  KnowledgeEdgeType,
  KnowledgeObjectType,
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

export async function buildGraphData(
  filter: {
    projectId?: string;
    workspaceId?: string;
    roomId?: string;
    includeTypes?: KnowledgeObjectType[];
  },
  userId: string
): Promise<GraphData> {
  try {
    const [room, ownedProjects] = await Promise.all([
      filter.roomId
        ? db.chatRoom.findFirst({
            where: { id: filter.roomId, userId },
            select: { projectId: true },
          })
        : Promise.resolve(null),
      db.project.findMany({
        where: { userId },
        select: { id: true },
      }),
    ]);

    if (filter.roomId && !room) throw new Error("Room not found");

    const ownedProjectIds = ownedProjects.map((project) => project.id);
    const projectId = filter.projectId ?? room?.projectId ?? undefined;
    if (projectId && !ownedProjectIds.includes(projectId)) {
      throw new Error("Project not found");
    }

    // KnowledgeObject and KnowledgeEdge are the graph's source of truth.
    // This read path never invents virtual nodes or relationships.
    const objectRecords = await db.knowledgeObject.findMany({
      where: {
        AND: [
          {
            OR: [
              { userId },
              ...(ownedProjectIds.length > 0
                ? [{ projectId: { in: ownedProjectIds } }]
                : []),
            ],
          },
          ...(projectId
            ? [
                {
                  OR: [
                    { projectId },
                    { userId, scope: { in: ["global", "user"] } },
                  ],
                },
              ]
            : []),
        ],
        ...(filter.workspaceId ? { workspaceId: filter.workspaceId } : {}),
        ...(filter.includeTypes?.length
          ? { type: { in: filter.includeTypes } }
          : {}),
      },
      orderBy: { createdAt: "desc" },
      take: 250,
    });

    const nodes = objectRecords.map(toKnowledgeNode);
    const nodeIds = nodes.map((node) => node.id);
    const edgeRecords =
      nodeIds.length === 0
        ? []
        : await db.knowledgeEdge.findMany({
            where: {
              fromObjectId: { in: nodeIds },
              toObjectId: { in: nodeIds },
            },
            orderBy: { createdAt: "desc" },
            take: 1000,
          });

    return {
      nodes,
      edges: edgeRecords.map(toKnowledgeEdge),
    };
  } catch (err) {
    throw new Error(
      `buildGraphData failed: ${err instanceof Error ? err.message : String(err)}`
    );
  }
}
