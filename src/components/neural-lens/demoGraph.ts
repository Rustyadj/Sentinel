// Neural Lens — deterministic OS-scale demo graph (Phase E).
//
// Builds a dense, multi-cluster graph spanning every category Sentinel
// tracks — Chat, Projects, Knowledge, Memory, Learning, Cybersecurity,
// Coding, Organization, Infrastructure, Voice — at a scale (5,000+ nodes,
// 15,000+ edges by default) big enough to exercise the GPU rendering path
// for real, not a toy. This is DEMO data — the Neural Lens surfaces it
// behind an explicit DEMO badge. SCOPED mode fetches the real /api/graph
// instead.

import { computeClusteredRadialLayout, type ClusteredLayoutInputNode } from "./radialLayout";
import { CLUSTER_IDS, CATEGORY_CLUSTER, HUB_CATEGORIES, type ClusterId, type NodeCategory } from "./categories";
import { ACCENT_COLORS } from "./palette";
import type { LensGraph, LensLink, LensNode } from "./types";

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Every category assigned to each cluster, derived from the canonical
 * CATEGORY_CLUSTER map so the demo graph can never drift out of sync with
 * the real taxonomy. */
const CATEGORIES_BY_CLUSTER: Record<ClusterId, NodeCategory[]> = (() => {
  const map = Object.fromEntries(CLUSTER_IDS.map((c) => [c, [] as NodeCategory[]])) as Record<ClusterId, NodeCategory[]>;
  for (const [category, cluster] of Object.entries(CATEGORY_CLUSTER) as [NodeCategory, ClusterId][]) {
    map[cluster].push(category);
  }
  // Voice has no categories of its own yet (see categories.ts) — seed it with
  // Conversation/Message so the region isn't empty in the demo.
  if (map.Voice.length === 0) map.Voice = ["Conversation", "Message"];
  return map;
})();

export interface DemoGraphOptions {
  seed?: number;
  /** Hubs per cluster. */
  hubsPerCluster?: number;
  /** Approximate total node count, including hubs. */
  targetNodes?: number;
  targetEdges?: number;
}

export function generateDemoGraph(options: DemoGraphOptions = {}): LensGraph {
  const { seed = 20260722, hubsPerCluster = 5, targetNodes = 5400, targetEdges = 52000 } = options;
  const rnd = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const layoutInput: ClusteredLayoutInputNode[] = [];
  const raw: Array<{ id: string; type: NodeCategory; clusterId: ClusterId; hubId: string; tier: number; label: string }> = [];
  const links: LensLink[] = [];
  const childrenOfHub = new Map<string, string[]>();

  const totalHubCount = hubsPerCluster * CLUSTER_IDS.length;
  const childTarget = Math.max(0, targetNodes - totalHubCount);
  const nodesPerCluster = Math.floor(childTarget / CLUSTER_IDS.length);

  for (const clusterId of CLUSTER_IDS) {
    const categories = CATEGORIES_BY_CLUSTER[clusterId];
    const hubCategories = categories.filter((c) => HUB_CATEGORIES.has(c));
    const leafCategories = categories.length > 0 ? categories : (["Task"] as NodeCategory[]);
    const hubPool = hubCategories.length > 0 ? hubCategories : leafCategories;

    const hubIds: string[] = [];
    for (let h = 0; h < hubsPerCluster; h++) {
      const hubId = `${clusterId}-hub-${h}`;
      const hubType = pick(hubPool);
      hubIds.push(hubId);
      raw.push({ id: hubId, type: hubType, clusterId, hubId, tier: 0, label: `${hubType} ${h + 1}` });
      layoutInput.push({ id: hubId, clusterId, hubId, parentId: hubId, tier: 0 });
    }

    let created = 0;
    for (let h = 0; h < hubIds.length; h++) {
      const hubId = hubIds[h];
      const isMajor = h === 0;
      const share = isMajor ? nodesPerCluster * 0.32 : (nodesPerCluster * 0.68) / (hubIds.length - 1 || 1);
      const childCount = Math.max(8, Math.floor(share));
      const hubChildren: string[] = [];
      childrenOfHub.set(hubId, hubChildren);

      let childIndex = 0;
      for (let c = 0; c < childCount && created < nodesPerCluster; c++) {
        const childId = `${hubId}-c${c}`;
        const type = pick(leafCategories);
        raw.push({ id: childId, type, clusterId, hubId, tier: 1, label: `${type} ${childIndex}` });
        layoutInput.push({ id: childId, clusterId, hubId, parentId: hubId, tier: 1 });
        links.push({ source: hubId, target: childId, weight: 0.35 + rnd() * 0.45 });
        hubChildren.push(childId);
        created++;
        childIndex++;

        if (rnd() > 0.7 && created < nodesPerCluster) {
          const grandCount = 1 + Math.floor(rnd() * 4);
          for (let g = 0; g < grandCount && created < nodesPerCluster; g++) {
            const gid = `${childId}-g${g}`;
            const type = pick(leafCategories);
            raw.push({ id: gid, type, clusterId, hubId, tier: 2, label: `${type} ${childIndex}` });
            layoutInput.push({ id: gid, clusterId, hubId, parentId: childId, tier: 2 });
            links.push({ source: childId, target: gid, weight: 0.2 + rnd() * 0.3 });
            created++;
            childIndex++;
          }
        }
      }
    }

    // Intra-cluster mesh so each region reads as a dense web, not a bare tree.
    for (const siblings of childrenOfHub.values()) {
      if (siblings.length < 3) continue;
      for (const child of siblings) {
        const crossCount = 1 + Math.floor(rnd() * 2);
        for (let k = 0; k < crossCount; k++) {
          const other = siblings[Math.floor(rnd() * siblings.length)];
          if (other !== child) links.push({ source: child, target: other, weight: 0.12 + rnd() * 0.28 });
        }
      }
    }

    // Hub backbone within the cluster.
    for (let i = 0; i < hubIds.length; i++) {
      if (rnd() > 0.4) links.push({ source: hubIds[i], target: pick(hubIds), weight: 0.5 + rnd() * 0.3 });
    }
  }

  // Sparse cross-cluster bridges — e.g. a Coding commit that closed a Task,
  // an Agent that wrote a Memory. These are the faint long strands that make
  // the whole thing read as one graph instead of ten separate ones.
  const bridgeCount = Math.round(CLUSTER_IDS.length * 45);
  for (let b = 0; b < bridgeCount; b++) {
    const a = raw[Math.floor(rnd() * raw.length)];
    const z = raw[Math.floor(rnd() * raw.length)];
    if (a.clusterId !== z.clusterId) links.push({ source: a.id, target: z.id, weight: 0.1 + rnd() * 0.18 });
  }

  const { positions, outlines } = computeClusteredRadialLayout(layoutInput, [...CLUSTER_IDS]);

  const nodes: LensNode[] = raw.map((n) => {
    const pos = positions.get(n.id)!;
    const isHub = n.tier === 0;
    const isMajorHub = isHub && n.id.endsWith("-hub-0");
    const accent = !!ACCENT_COLORS[n.type] && rnd() > 0.82;
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      hubId: n.hubId,
      clusterId: n.clusterId,
      x: pos.x,
      y: pos.y,
      val: isMajorHub ? 6.4 : isHub ? 3.6 : n.tier === 1 ? 2.15 : 1.35,
      accent,
      isHub,
      active: false,
    };
  });

  const nodeIds = new Set(nodes.map((n) => n.id));
  const seen = new Set<string>();
  const cleanLinks: LensLink[] = [];
  for (const l of links) {
    if (l.source === l.target || !nodeIds.has(l.source) || !nodeIds.has(l.target)) continue;
    const key = l.source < l.target ? `${l.source}|${l.target}` : `${l.target}|${l.source}`;
    if (seen.has(key)) continue;
    seen.add(key);
    cleanLinks.push(l);
  }

  // Fill toward the edge target with irregular intra-family synapses so
  // density matches real knowledge-graph texture rather than a bare tree.
  const membersByHub = new Map<string, typeof raw>();
  for (const node of raw) {
    const members = membersByHub.get(node.hubId) ?? [];
    members.push(node);
    membersByHub.set(node.hubId, members);
  }
  const families = [...membersByHub.values()];
  for (let pass = 0; cleanLinks.length < targetEdges && pass < 60; pass++) {
    for (const family of families) {
      for (const source of family) {
        if (cleanLinks.length >= targetEdges) break;
        const target = family[Math.floor(rnd() * family.length)];
        if (!target || target.id === source.id) continue;
        const key = source.id < target.id ? `${source.id}|${target.id}` : `${target.id}|${source.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cleanLinks.push({ source: source.id, target: target.id, weight: 0.08 + rnd() * 0.14 });
      }
    }
  }

  return {
    nodes,
    links: cleanLinks,
    meta: { demo: true, nodeCount: nodes.length, edgeCount: cleanLinks.length },
    clusterOutlines: outlines,
  };
}
