// Neural Lens — deterministic OS-scale demo graph.
//
// Builds a dense, multi-cluster graph spanning every region Sentinel tracks —
// Agents at the core, and Communications, Projects, Data Lake, Memory,
// Workflows, Cybersecurity, Code, Infrastructure, Voice and External Partners
// spread over the shell — at a scale big enough to exercise the GPU path for
// real rather than a toy. This is DEMO data — the Neural Lens surfaces it
// behind an explicit DEMO badge. SCOPED mode fetches the real /api/graph
// instead, and gets the same geometry from the same layout function.

import { computeGlobeLayout, type GlobeLayoutInputNode } from "./globeLayout";
import {
  CLUSTER_IDS,
  CLUSTER_LABEL,
  CATEGORY_CLUSTER,
  CORE_CLUSTER_ID,
  HUB_CATEGORIES,
  type ClusterId,
  type NodeCategory,
} from "./categories";
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
  // Voice and External have no categories of their own yet (see
  // categories.ts) — seed them with the closest existing node types so the
  // regions aren't empty in the demo.
  if (map.Voice.length === 0) map.Voice = ["Conversation", "Message"];
  if (map.External.length === 0) map.External = ["Organization", "Provider", "Agent"];
  return map;
})();

export interface DemoGraphOptions {
  seed?: number;
  /** Hubs per cluster. */
  hubsPerCluster?: number;
  /** Exact total node count, including hubs. */
  targetNodes?: number;
  targetEdges?: number;
}

export function generateDemoGraph(options: DemoGraphOptions = {}): LensGraph {
  const { seed = 20260722, hubsPerCluster = 5, targetNodes = 24000, targetEdges = 150000 } = options;
  const rnd = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const layoutInput: GlobeLayoutInputNode[] = [];
  const raw: Array<{ id: string; type: NodeCategory; clusterId: ClusterId; hubId: string; tier: number; label: string }> = [];
  const links: LensLink[] = [];
  const majorHubByCluster = new Map<ClusterId, string>();

  // Node budget is split so the total lands exactly on targetNodes: every
  // cluster gets the same quota of non-hub nodes, and the leftover from the
  // division is handed to the first few clusters one node at a time.
  const totalHubCount = hubsPerCluster * CLUSTER_IDS.length;
  const childBudget = Math.max(0, targetNodes - totalHubCount);
  const baseQuota = Math.floor(childBudget / CLUSTER_IDS.length);
  const quotaRemainder = childBudget - baseQuota * CLUSTER_IDS.length;

  CLUSTER_IDS.forEach((clusterId, clusterIndex) => {
    const quota = baseQuota + (clusterIndex < quotaRemainder ? 1 : 0);
    const categories = CATEGORIES_BY_CLUSTER[clusterId];
    const hubCategories = categories.filter((c) => HUB_CATEGORIES.has(c));
    const leafCategories = categories.length > 0 ? categories : (["Task"] as NodeCategory[]);
    const hubPool = hubCategories.length > 0 ? hubCategories : leafCategories;
    const childrenOfHub = new Map<string, string[]>();

    const hubIds: string[] = [];
    for (let h = 0; h < hubsPerCluster; h++) {
      const hubId = `${clusterId}-hub-${h}`;
      const hubType = pick(hubPool);
      hubIds.push(hubId);
      // The primary hub carries the region's own name, so the label drawn on
      // the globe and the label in its tooltip are the same thing.
      const label = h === 0 ? CLUSTER_LABEL[clusterId] : `${hubType} ${h}`;
      raw.push({ id: hubId, type: hubType, clusterId, hubId, tier: 0, label });
      layoutInput.push({ id: hubId, clusterId, hubId, parentId: hubId, tier: 0 });
    }
    majorHubByCluster.set(clusterId, hubIds[0]);

    let created = 0;
    const addChild = (hubId: string, index: number): string => {
      const childId = `${hubId}-c${index}`;
      const type = pick(leafCategories);
      raw.push({ id: childId, type, clusterId, hubId, tier: 1, label: `${type} ${index}` });
      layoutInput.push({ id: childId, clusterId, hubId, parentId: hubId, tier: 1 });
      links.push({ source: hubId, target: childId, weight: 0.35 + rnd() * 0.45, type: "part_of" });
      const siblings = childrenOfHub.get(hubId);
      if (siblings) siblings.push(childId);
      else childrenOfHub.set(hubId, [childId]);
      created++;
      return childId;
    };

    for (let h = 0; h < hubIds.length && created < quota; h++) {
      const hubId = hubIds[h];
      const isMajor = h === 0;
      const share = isMajor ? quota * 0.32 : (quota * 0.68) / (hubIds.length - 1 || 1);
      const childCount = Math.max(8, Math.floor(share));

      let childIndex = 0;
      for (let c = 0; c < childCount && created < quota; c++) {
        const childId = addChild(hubId, childIndex);
        childIndex++;

        if (rnd() > 0.7 && created < quota) {
          const grandCount = 1 + Math.floor(rnd() * 4);
          for (let g = 0; g < grandCount && created < quota; g++) {
            const gid = `${childId}-g${g}`;
            const type = pick(leafCategories);
            raw.push({ id: gid, type, clusterId, hubId, tier: 2, label: `${type} ${childIndex}` });
            layoutInput.push({ id: gid, clusterId, hubId, parentId: childId, tier: 2 });
            links.push({ source: childId, target: gid, weight: 0.2 + rnd() * 0.3, type: "part_of" });
            created++;
            childIndex++;
          }
        }
      }
    }

    // Grandchildren consume the quota faster than the per-hub child counts
    // predict, so a cluster can finish under budget. Top up on the primary
    // hub until the quota is met exactly — the totals a status readout shows
    // should be the totals that were asked for.
    let topUp = childrenOfHub.get(hubIds[0])?.length ?? 0;
    while (created < quota) {
      addChild(hubIds[0], topUp);
      topUp++;
    }

    // Intra-cluster mesh so each region reads as a dense web, not a bare tree.
    for (const siblings of childrenOfHub.values()) {
      if (siblings.length < 3) continue;
      for (const child of siblings) {
        const crossCount = 1 + Math.floor(rnd() * 2);
        for (let k = 0; k < crossCount; k++) {
          const other = siblings[Math.floor(rnd() * siblings.length)];
          if (other !== child) links.push({ source: child, target: other, weight: 0.12 + rnd() * 0.28, type: "related_to" });
        }
      }
    }

    // Hub backbone within the cluster.
    for (let i = 0; i < hubIds.length; i++) {
      if (rnd() > 0.4) links.push({ source: hubIds[i], target: pick(hubIds), weight: 0.5 + rnd() * 0.3, type: "related_to" });
    }
  });

  // Core spokes: the Agents region sits at the centre of the globe, and every
  // other region answers to it. These are the long strands that read as the
  // graph's skeleton when you look at the whole planet at once. Typed as
  // "delegates_to" — the agent core is what every other region ultimately
  // acts on behalf of.
  const coreHub = majorHubByCluster.get(CORE_CLUSTER_ID);
  if (coreHub) {
    for (const [clusterId, hubId] of majorHubByCluster) {
      if (clusterId === CORE_CLUSTER_ID) continue;
      links.push({ source: coreHub, target: hubId, weight: 0.85, type: "delegates_to" });
    }
  }

  // Cross-cluster bridges — e.g. a Coding commit that closed a Task, an Agent
  // that wrote a Memory. These are the long strands that make the whole thing
  // read as one graph instead of eleven separate ones, so there are enough of
  // them to see structure at planet scale, but they stay a rounding error
  // against the ~100k intra-region edges.
  const bridgeCount = Math.round(CLUSTER_IDS.length * 260);
  for (let b = 0; b < bridgeCount; b++) {
    const a = raw[Math.floor(rnd() * raw.length)];
    const z = raw[Math.floor(rnd() * raw.length)];
    if (a.clusterId !== z.clusterId) links.push({ source: a.id, target: z.id, weight: 0.1 + rnd() * 0.18, type: "references" });
  }

  const { positions, regions } = computeGlobeLayout(layoutInput, [...CLUSTER_IDS], {
    coreClusterId: CORE_CLUSTER_ID,
  });

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
      z: pos.z,
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
  for (let pass = 0; cleanLinks.length < targetEdges && pass < 80; pass++) {
    for (const family of families) {
      for (const source of family) {
        if (cleanLinks.length >= targetEdges) break;
        const target = family[Math.floor(rnd() * family.length)];
        if (!target || target.id === source.id) continue;
        const key = source.id < target.id ? `${source.id}|${target.id}` : `${target.id}|${source.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cleanLinks.push({ source: source.id, target: target.id, weight: 0.08 + rnd() * 0.14, type: "related_to" });
      }
    }
  }

  return {
    nodes,
    links: cleanLinks,
    meta: { demo: true, nodeCount: nodes.length, edgeCount: cleanLinks.length },
    regions,
  };
}
