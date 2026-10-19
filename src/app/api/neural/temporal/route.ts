import { filterOperationalNodes, filterOperationalEdges, operationalGraphAsOf } from "@/lib/knowledge/operational-graph";
import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { getReadableProjectIds } from "@/lib/knowledge/access";
import { toKnowledgeNode } from "@/lib/knowledge/objects";
import {
  listKnowledgeEdgesAsOf,
  listKnowledgeObjectsAsOf,
} from "@/lib/neural-engine/temporal-service";

/**
 * GET /api/neural/temporal?at=<ISO8601>&projectId=&workspaceId=
 *
 * Reconstructs the graph as it existed at `at`, using the real supersession
 * windows from Phase A (validFrom/validTo) rather than the live "now" state.
 * Returned in the same {nodes,edges} shape as /api/graph so the Neural Lens
 * client can feed it through the same buildLensGraphFromApi mapper.
 */
export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url);
  const atParam = searchParams.get("at");
  const projectId = searchParams.get("projectId") ?? undefined;
  const workspaceId = searchParams.get("workspaceId") ?? undefined;

  const at = atParam ? new Date(atParam) : new Date();
  if (Number.isNaN(at.getTime())) {
    return NextResponse.json({ error: "Invalid `at` timestamp", nodes: [], edges: [] }, { status: 400 });
  }

  try {
    const user = await requireUser();
    const readableProjectIds = await getReadableProjectIds(user.id);

    if (projectId && !readableProjectIds.includes(projectId)) {
      throw new Error("Project not found");
    }

    const objects = await listKnowledgeObjectsAsOf(
      at,
      { userId: user.id, readableProjectIds },
      { projectId, workspaceId },
    );
    const nodes = (await filterOperationalNodes(user.id, objects)).filter(record => !(record.metadata as { operational?: boolean }).operational).map(toKnowledgeNode);
    const operational = projectId ? { nodes: [], edges: [], partial: false } : await operationalGraphAsOf(user.id, at, workspaceId);
    nodes.push(...operational.nodes.map(toKnowledgeNode));

    const edgeRecords = await listKnowledgeEdgesAsOf(
      at,
      nodes.map((n) => n.id),
    );
    const operationalIds = new Set(operational.nodes.map(node => node.id));
    const edges = (await filterOperationalEdges(user.id, edgeRecords)).filter(edge => !operationalIds.has(edge.fromObjectId) && !operationalIds.has(edge.toObjectId)).map((e) => ({
      fromObjectId: e.fromObjectId,
      toObjectId: e.toObjectId,
      weight: e.weight,
      type: e.type,
    }));

    edges.push(...operational.edges.map(edge => ({ fromObjectId: edge.fromObjectId, toObjectId: edge.toObjectId, weight: edge.weight, type: edge.type })));
    return NextResponse.json({ nodes, edges, partial: operational.partial, at: at.toISOString(), source: "temporal" });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Temporal graph query failed";
    const status = message === "Unauthorized" ? 401 : message.includes("not found") ? 404 : 500;
    return NextResponse.json({ error: message, nodes: [], edges: [] }, { status });
  }
}
