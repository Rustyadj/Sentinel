// Neural Lens — map the real /api/graph payload into a radial LensGraph
// (Phase D, SCOPED mode). Pure so it can be reasoned about without the DOM.

import { computeRadialLayout, type LayoutInputNode } from "./radialLayout";
import { ACCENT_COLORS } from "./palette";
import type { LensGraph, LensLink, LensNode } from "./types";

interface ApiNode {
  id: string;
  type: string;
  title: string;
}
interface ApiEdge {
  fromObjectId: string;
  toObjectId: string;
  weight?: number;
}

const HUB_TYPES = new Set(["Project", "Workspace", "Conversation", "Organization"]);
const HUB_DEGREE_THRESHOLD = 6;

/**
 * Build a hub-and-spoke LensGraph from arbitrary knowledge nodes/edges: hubs
 * are type-hubs or high-degree nodes; every other node attaches (tier 1) to a
 * hub it shares an edge with, or to a synthetic "orphans" hub. Positions come
 * from the shared radial layout so SCOPED and DEMO look consistent.
 */
export function buildLensGraphFromApi(api: { nodes: ApiNode[]; edges: ApiEdge[] }): LensGraph {
  const degree = new Map<string, number>();
  for (const e of api.edges) {
    degree.set(e.fromObjectId, (degree.get(e.fromObjectId) ?? 0) + 1);
    degree.set(e.toObjectId, (degree.get(e.toObjectId) ?? 0) + 1);
  }

  const hubIds = new Set(
    api.nodes
      .filter((n) => HUB_TYPES.has(n.type) || (degree.get(n.id) ?? 0) >= HUB_DEGREE_THRESHOLD)
      .map((n) => n.id),
  );

  // Adjacency for hub assignment.
  const adjacency = new Map<string, string[]>();
  for (const e of api.edges) {
    if (!adjacency.has(e.fromObjectId)) adjacency.set(e.fromObjectId, []);
    if (!adjacency.has(e.toObjectId)) adjacency.set(e.toObjectId, []);
    adjacency.get(e.fromObjectId)!.push(e.toObjectId);
    adjacency.get(e.toObjectId)!.push(e.fromObjectId);
  }

  const ORPHAN_HUB = "__orphans__";
  const hubOf = new Map<string, string>();
  for (const n of api.nodes) {
    if (hubIds.has(n.id)) {
      hubOf.set(n.id, n.id);
      continue;
    }
    const neighborHub = (adjacency.get(n.id) ?? []).find((nb) => hubIds.has(nb));
    hubOf.set(n.id, neighborHub ?? ORPHAN_HUB);
  }

  const hasOrphans = [...hubOf.values()].includes(ORPHAN_HUB);

  const layoutInput: LayoutInputNode[] = [];
  for (const n of api.nodes) {
    const hub = hubOf.get(n.id)!;
    const isHub = hubIds.has(n.id);
    layoutInput.push({
      id: n.id,
      hubId: hub,
      parentId: isHub ? n.id : hub,
      tier: isHub ? 0 : 1,
    });
  }
  if (hasOrphans) {
    layoutInput.push({ id: ORPHAN_HUB, hubId: ORPHAN_HUB, parentId: ORPHAN_HUB, tier: 0 });
  }

  const positions = computeRadialLayout(layoutInput);

  const nodes: LensNode[] = api.nodes.map((n) => {
    const pos = positions.get(n.id) ?? { x: 0, y: 0 };
    const isHub = hubIds.has(n.id);
    return {
      id: n.id,
      label: n.title,
      type: n.type,
      hubId: hubOf.get(n.id)!,
      x: pos.x,
      y: pos.y,
      val: isHub ? 7 : 2.2,
      accent: !!ACCENT_COLORS[n.type],
      active: false,
    };
  });

  if (hasOrphans) {
    const pos = positions.get(ORPHAN_HUB) ?? { x: 0, y: 0 };
    nodes.push({
      id: ORPHAN_HUB,
      label: "Unclustered",
      type: "Workspace",
      hubId: ORPHAN_HUB,
      x: pos.x,
      y: pos.y,
      val: 6,
      active: false,
    });
  }

  const nodeIds = new Set(nodes.map((n) => n.id));
  const links: LensLink[] = api.edges
    .filter((e) => nodeIds.has(e.fromObjectId) && nodeIds.has(e.toObjectId))
    .map((e) => ({ source: e.fromObjectId, target: e.toObjectId, weight: e.weight ?? 0.4 }));

  // Attach orphan-hub spokes so unclustered nodes aren't floating.
  if (hasOrphans) {
    for (const n of nodes) {
      if (n.hubId === ORPHAN_HUB && n.id !== ORPHAN_HUB) {
        links.push({ source: ORPHAN_HUB, target: n.id, weight: 0.15 });
      }
    }
  }

  return {
    nodes,
    links,
    meta: { demo: false, nodeCount: nodes.length, edgeCount: links.length },
  };
}
