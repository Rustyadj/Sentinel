// Neural Lens — map the real /api/graph payload onto the globe (SCOPED mode).
// Pure so it can be reasoned about without the DOM.

import { computeGlobeLayout, type GlobeLayoutInputNode } from "./globeLayout";
import { ACCENT_COLORS } from "./palette";
import { CLUSTER_IDS, CORE_CLUSTER_ID, clusterOf, isHubCategory } from "./categories";
import type { LensGraph, LensLink, LensNode } from "./types";

interface ApiNode {
  id: string;
  type: string;
  title: string;
  workspaceId?: string | null;
}
interface ApiEdge {
  fromObjectId: string;
  toObjectId: string;
  weight?: number;
  /** Real relationship type from KnowledgeEdgeType (lib/knowledge/types.ts) —
   * e.g. "created_by", "depends_on", "triggered_by". */
  type?: string;
}

const HUB_DEGREE_THRESHOLD = 6;

/**
 * Build a hub-and-spoke LensGraph from arbitrary knowledge nodes/edges,
 * grouped first by OS-level cluster (categories.ts) and laid out on the same
 * globe DEMO mode uses, so SCOPED and DEMO read as the same graph.
 * Within a cluster, hubs are hub-eligible categories or high-degree nodes;
 * every other node attaches (tier 1) to a hub it shares an edge with, or to
 * a synthetic per-cluster "orphans" hub.
 */
export function buildLensGraphFromApi(api: { nodes: ApiNode[]; edges: ApiEdge[] }): LensGraph {
  const degree = new Map<string, number>();
  for (const e of api.edges) {
    degree.set(e.fromObjectId, (degree.get(e.fromObjectId) ?? 0) + 1);
    degree.set(e.toObjectId, (degree.get(e.toObjectId) ?? 0) + 1);
  }

  const clusterOfNode = new Map<string, string>();
  for (const n of api.nodes) clusterOfNode.set(n.id, clusterOf(n.type));

  const hubIds = new Set(
    api.nodes
      .filter((n) => isHubCategory(n.type) || (degree.get(n.id) ?? 0) >= HUB_DEGREE_THRESHOLD)
      .map((n) => n.id),
  );

  const adjacency = new Map<string, string[]>();
  for (const e of api.edges) {
    if (!adjacency.has(e.fromObjectId)) adjacency.set(e.fromObjectId, []);
    if (!adjacency.has(e.toObjectId)) adjacency.set(e.toObjectId, []);
    adjacency.get(e.fromObjectId)!.push(e.toObjectId);
    adjacency.get(e.toObjectId)!.push(e.fromObjectId);
  }

  const orphanHubOf = (clusterId: string) => `__orphans__:${clusterId}`;
  const hubOf = new Map<string, string>();
  for (const n of api.nodes) {
    if (hubIds.has(n.id)) {
      hubOf.set(n.id, n.id);
      continue;
    }
    const neighborHub = (adjacency.get(n.id) ?? []).find((nb) => hubIds.has(nb) && clusterOfNode.get(nb) === clusterOfNode.get(n.id));
    hubOf.set(n.id, neighborHub ?? orphanHubOf(clusterOfNode.get(n.id)!));
  }

  const orphanClusters = new Set<string>();
  for (const [nodeId, hub] of hubOf) {
    if (hub === orphanHubOf(clusterOfNode.get(nodeId)!)) orphanClusters.add(clusterOfNode.get(nodeId)!);
  }

  const layoutInput: GlobeLayoutInputNode[] = [];
  for (const n of api.nodes) {
    const clusterId = clusterOfNode.get(n.id)!;
    const hub = hubOf.get(n.id)!;
    const isHub = hubIds.has(n.id);
    layoutInput.push({
      id: n.id,
      clusterId,
      hubId: hub,
      parentId: isHub ? n.id : hub,
      tier: isHub ? 0 : 1,
    });
  }
  for (const clusterId of orphanClusters) {
    const id = orphanHubOf(clusterId);
    layoutInput.push({ id, clusterId, hubId: id, parentId: id, tier: 0 });
  }

  // Cluster order comes from the canonical list, not from whatever order the
  // API happened to return, so a region keeps the same patch of the globe
  // between refreshes even as the underlying rows change.
  const { positions, regions } = computeGlobeLayout(layoutInput, [...CLUSTER_IDS], {
    coreClusterId: CORE_CLUSTER_ID,
  });

  const nodes: LensNode[] = api.nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0, z: 0 };
    const isHub = hubIds.has(n.id);
    return {
      id: n.id,
      label: n.title,
      type: n.type,
      hubId: hubOf.get(n.id)!,
      clusterId: clusterOfNode.get(n.id)! as LensNode["clusterId"],
      x: pos.x,
      y: pos.y,
      z: pos.z,
      val: isHub ? 7 : 2.2,
      accent: !!ACCENT_COLORS[n.type],
      isHub,
      active: false,
      workspaceId: n.workspaceId ?? undefined,
    };
  });

  for (const clusterId of orphanClusters) {
    const id = orphanHubOf(clusterId);
    const pos = positions.get(id) ?? { x: 0, y: 0, z: 0 };
    nodes.push({
      id,
      label: "Unclustered",
      type: "Workspace",
      hubId: id,
      clusterId: clusterId as LensNode["clusterId"],
      x: pos.x,
      y: pos.y,
      z: pos.z,
      val: 6,
      isHub: true,
      active: false,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: LensLink[] = api.edges
    .filter((e) => nodeIds.has(e.fromObjectId) && nodeIds.has(e.toObjectId))
    .map((e) => ({ source: e.fromObjectId, target: e.toObjectId, weight: e.weight ?? 0.4, type: e.type }));

  for (const clusterId of orphanClusters) {
    const id = orphanHubOf(clusterId);
    for (const n of nodes) {
      if (n.hubId === id && n.id !== id) links.push({ source: id, target: n.id, weight: 0.15, type: "part_of" });
    }
  }

  return {
    nodes,
    links,
    meta: { demo: false, nodeCount: nodes.length, edgeCount: links.length },
    regions,
  };
}
