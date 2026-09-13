import { db } from "@/lib/db";
import { toKnowledgeNode } from "@/lib/knowledge/objects";
import { getReadableProjectIds } from "@/lib/knowledge/access";
import type { KnowledgeEdge, KnowledgeNode, KnowledgeObjectType } from "@/lib/knowledge/types";

/**
 * Scoped graph retrieval.
 *
 * The knowledge graph can be arbitrarily large, so the UI never asks for it.
 * Every read here is bounded: an entry set of the most relevant objects, or a
 * breadth-limited neighbourhood around one focus node. Access is the same rule
 * the rest of the knowledge engine uses — a user's own objects plus the
 * projects they can read.
 */

export const MAX_SCOPE_LIMIT = 400;
export const DEFAULT_SCOPE_LIMIT = 120;

export interface ScopedGraphRequest {
  userId: string;
  /** KnowledgeObject id to centre on. Absent = entry view. */
  focusId?: string;
  /** Neighbourhood radius around the focus, 1 or 2. */
  depth?: number;
  limit?: number;
  types?: KnowledgeObjectType[];
  /** Only include objects created at/after this instant. */
  since?: Date;
  projectId?: string;
}

export interface ScopedGraph {
  nodes: (KnowledgeNode & { degree: number; truncatedDegree: number })[];
  edges: KnowledgeEdge[];
  focusId: string | null;
  /** True when more neighbours exist than were returned. */
  partial: boolean;
  totalVisible: number;
}

function toKnowledgeEdge(record: {
  id: string; fromObjectId: string; toObjectId: string; type: string; weight: number; metadata: unknown;
}): KnowledgeEdge {
  return {
    id: record.id,
    fromObjectId: record.fromObjectId,
    toObjectId: record.toObjectId,
    type: record.type as KnowledgeEdge["type"],
    weight: record.weight,
    metadata: (record.metadata as Record<string, unknown>) ?? {},
  };
}

async function accessScope(userId: string, projectId?: string) {
  const readableProjectIds = await getReadableProjectIds(userId);
  if (projectId && !readableProjectIds.includes(projectId)) {
    throw new Error("Project not found");
  }
  return {
    OR: [
      { userId },
      ...(readableProjectIds.length ? [{ projectId: { in: readableProjectIds } }] : []),
    ],
    ...(projectId ? { projectId } : {}),
  };
}

/** Objects the caller may see, filtered by type/recency, newest first. */
async function readableObjects(where: object, request: ScopedGraphRequest, take: number) {
  return db.knowledgeObject.findMany({
    where: {
      AND: [
        where,
        ...(request.types?.length ? [{ type: { in: request.types } }] : []),
        ...(request.since ? [{ createdAt: { gte: request.since } }] : []),
      ],
    },
    orderBy: { createdAt: "desc" },
    take,
  });
}

/**
 * Expand outward from a focus node one hop at a time, stopping as soon as the
 * budget is reached. Everything returned is a real edge between two objects
 * the caller can read.
 */
async function expand(seedIds: string[], allowedIds: Set<string>, depth: number, limit: number) {
  const included = new Set(seedIds);
  const edges = new Map<string, KnowledgeEdge>();
  let frontier = seedIds;
  let truncated = false;

  for (let level = 0; level < depth && frontier.length > 0 && included.size < limit; level += 1) {
    const records = await db.knowledgeEdge.findMany({
      where: { OR: [{ fromObjectId: { in: frontier } }, { toObjectId: { in: frontier } }] },
      orderBy: [{ weight: "desc" }, { createdAt: "desc" }],
      take: limit * 4,
    });

    const next: string[] = [];
    for (const record of records) {
      const other = frontier.includes(record.fromObjectId) ? record.toObjectId : record.fromObjectId;
      if (!allowedIds.has(record.fromObjectId) || !allowedIds.has(record.toObjectId)) continue;
      if (!included.has(other)) {
        if (included.size >= limit) { truncated = true; continue; }
        included.add(other);
        next.push(other);
      }
      edges.set(record.id, toKnowledgeEdge(record));
    }
    frontier = next;
  }

  return { included, edges: [...edges.values()], truncated };
}

export async function getScopedGraph(request: ScopedGraphRequest): Promise<ScopedGraph> {
  const limit = Math.min(Math.max(request.limit ?? DEFAULT_SCOPE_LIMIT, 10), MAX_SCOPE_LIMIT);
  const depth = Math.min(Math.max(request.depth ?? 1, 1), 2);
  const where = await accessScope(request.userId, request.projectId);

  // The candidate pool is itself bounded: a focused view still only considers
  // objects the caller can read, never the whole table.
  const pool = await readableObjects(where, request, Math.min(MAX_SCOPE_LIMIT * 4, 1200));
  const poolById = new Map(pool.map((record) => [record.id, record]));
  const allowedIds = new Set(poolById.keys());

  let includedIds: Set<string>;
  let edges: KnowledgeEdge[];
  let truncated = false;

  if (request.focusId) {
    if (!allowedIds.has(request.focusId)) throw new Error("Node not found");
    const expansion = await expand([request.focusId], allowedIds, depth, limit);
    includedIds = expansion.included;
    edges = expansion.edges;
    truncated = expansion.truncated;
  } else {
    // Entry view: the most recent readable objects, plus every edge among them.
    const seed = pool.slice(0, limit).map((record) => record.id);
    includedIds = new Set(seed);
    truncated = pool.length > seed.length;
    const records = seed.length
      ? await db.knowledgeEdge.findMany({
          where: { fromObjectId: { in: seed }, toObjectId: { in: seed } },
          orderBy: [{ weight: "desc" }, { createdAt: "desc" }],
          take: limit * 8,
        })
      : [];
    edges = records.map(toKnowledgeEdge);
  }

  // Degree is computed over the returned subgraph, and the count of edges that
  // point outside it is reported separately so the UI can show "more to expand"
  // instead of implying a node is a leaf.
  const degree = new Map<string, number>();
  for (const edge of edges) {
    degree.set(edge.fromObjectId, (degree.get(edge.fromObjectId) ?? 0) + 1);
    degree.set(edge.toObjectId, (degree.get(edge.toObjectId) ?? 0) + 1);
  }

  const outside = await db.knowledgeEdge.groupBy({
    by: ["fromObjectId"],
    where: { fromObjectId: { in: [...includedIds] } },
    _count: { _all: true },
  }).catch(() => [] as { fromObjectId: string; _count: { _all: number } }[]);
  const totalDegree = new Map(outside.map((row) => [row.fromObjectId, row._count._all]));

  const nodes = [...includedIds]
    .map((id) => poolById.get(id))
    .filter((record): record is NonNullable<typeof record> => Boolean(record))
    .map((record) => {
      const node = toKnowledgeNode(record);
      const visible = degree.get(node.id) ?? 0;
      return {
        ...node,
        degree: visible,
        truncatedDegree: Math.max((totalDegree.get(node.id) ?? visible) - visible, 0),
      };
    });

  return {
    nodes,
    edges: edges.filter((edge) => includedIds.has(edge.fromObjectId) && includedIds.has(edge.toObjectId)),
    focusId: request.focusId ?? null,
    partial: truncated,
    totalVisible: nodes.length,
  };
}

/** Node search for the graph's own search box. Bounded and access-scoped. */
export async function searchGraphNodes(userId: string, query: string, limit = 20) {
  const term = query.trim();
  if (term.length < 2) return [];
  const where = await accessScope(userId);
  const records = await db.knowledgeObject.findMany({
    where: {
      AND: [
        where,
        { OR: [{ title: { contains: term, mode: "insensitive" } }, { summary: { contains: term, mode: "insensitive" } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 50),
  });
  return records.map(toKnowledgeNode);
}

/** Everything the inspector shows for one node — real relations only. */
export async function getNodeDetail(userId: string, nodeId: string) {
  const where = await accessScope(userId);
  const record = await db.knowledgeObject.findFirst({ where: { AND: [where, { id: nodeId }] } });
  if (!record) throw new Error("Node not found");

  const edges = await db.knowledgeEdge.findMany({
    where: { OR: [{ fromObjectId: nodeId }, { toObjectId: nodeId }] },
    orderBy: [{ weight: "desc" }, { createdAt: "desc" }],
    take: 60,
  });
  const neighbourIds = [...new Set(edges.map((edge) => (edge.fromObjectId === nodeId ? edge.toObjectId : edge.fromObjectId)))];
  const neighbours = neighbourIds.length
    ? await db.knowledgeObject.findMany({ where: { AND: [where, { id: { in: neighbourIds } }] } })
    : [];
  const neighbourById = new Map(neighbours.map((neighbour) => [neighbour.id, toKnowledgeNode(neighbour)]));

  return {
    node: toKnowledgeNode(record),
    connections: edges
      .map((edge) => {
        const otherId = edge.fromObjectId === nodeId ? edge.toObjectId : edge.fromObjectId;
        const other = neighbourById.get(otherId);
        return other ? { edge: toKnowledgeEdge(edge), node: other, direction: edge.fromObjectId === nodeId ? "out" as const : "in" as const } : null;
      })
      .filter((entry): entry is NonNullable<typeof entry> => entry !== null),
    /** Edges to objects the caller cannot read are counted, never revealed. */
    hiddenConnections: edges.length - neighbourById.size,
  };
}
