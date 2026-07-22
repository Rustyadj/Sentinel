// Neural Lens — deterministic demo graph (Phase D, pure).
//
// Builds a dense hub-and-spoke knowledge graph that reads like the reference
// screenshot (~880 nodes / ~2700 edges, a few big dandelion hubs + smaller
// peripheral clusters, mostly neutral dots with sparse colour accents). This
// is DEMO data — the Neural Lens surfaces it behind an explicit DEMO badge
// (mirroring the reference's own "DEMO" chip). SCOPED mode fetches the real
// /api/graph instead.

import { computeRadialLayout, type LayoutInputNode } from "./radialLayout";
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

/** Accent node types (get a tint); everything else is a neutral dot. */
const ACCENT_TYPES = ["Memory", "Decision", "Agent", "Note", "Task", "Artifact"];
const HUB_TYPES = ["Project", "Workspace", "Conversation"];
const LEAF_TYPES = ["Message", "File", "Note", "Memory", "Task", "Concept", "Decision", "Artifact"];

export interface DemoGraphOptions {
  seed?: number;
  hubCount?: number;
  targetNodes?: number;
  targetEdges?: number;
}

export function generateDemoGraph(options: DemoGraphOptions = {}): LensGraph {
  const { seed = 20260722, hubCount = 4, targetNodes = 885, targetEdges = 2715 } = options;
  const rnd = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const layoutInput: LayoutInputNode[] = [];
  const raw: Array<{ id: string; type: string; hubId: string; tier: number; label: string }> = [];
  const links: LensLink[] = [];
  const childrenOfHub = new Map<string, string[]>();

  // A few big major hubs plus a couple of minor peripheral clusters — the
  // reference is dominated by 3-4 dense dandelions.
  const minorHubs = 2;
  const totalHubs = hubCount + minorHubs;

  let created = 0;
  const hubIds: string[] = [];

  for (let h = 0; h < totalHubs; h++) {
    const hubId = `hub-${h}`;
    hubIds.push(hubId);
    const hubType = pick(HUB_TYPES);
    raw.push({ id: hubId, type: hubType, hubId, tier: 0, label: `${hubType} ${h + 1}` });
    layoutInput.push({ id: hubId, hubId, parentId: hubId, tier: 0 });
    created++;
  }

  // Distribute remaining nodes: major hubs get a large fan, minor hubs a small one.
  const remaining = targetNodes - created;
  for (let h = 0; h < totalHubs; h++) {
    const hubId = hubIds[h];
    const isMajor = h < hubCount;
    // Long-tailed share so hubs differ in density like the reference.
    const share = isMajor
      ? remaining * (0.14 + rnd() * 0.06)
      : remaining * (0.02 + rnd() * 0.02);
    const childCount = Math.max(6, Math.floor(share));

    let childIndex = 0;
    const hubChildren: string[] = [];
    childrenOfHub.set(hubId, hubChildren);
    for (let c = 0; c < childCount && created < targetNodes; c++) {
      const childId = `${hubId}-c${c}`;
      const type = pick(LEAF_TYPES);
      raw.push({ id: childId, type, hubId, tier: 1, label: `${type} ${childIndex}` });
      layoutInput.push({ id: childId, hubId, parentId: hubId, tier: 1 });
      links.push({ source: hubId, target: childId, weight: 0.35 + rnd() * 0.45 });
      hubChildren.push(childId);
      created++;
      childIndex++;

      // Some children sprout a small grandchild cluster (the fine radial tips).
      if (rnd() > 0.72 && created < targetNodes) {
        const grandCount = 1 + Math.floor(rnd() * 4);
        for (let g = 0; g < grandCount && created < targetNodes; g++) {
          const gid = `${childId}-g${g}`;
          const type = pick(LEAF_TYPES);
          raw.push({ id: gid, type, hubId, tier: 2, label: `${type} ${childIndex}` });
          layoutInput.push({ id: gid, hubId, parentId: childId, tier: 2 });
          links.push({ source: childId, target: gid, weight: 0.2 + rnd() * 0.3 });
          created++;
          childIndex++;
        }
      }
    }
  }

  // Intra-cluster mesh: link each child to a couple of its hub siblings so the
  // constellation reads as a dense web (~2-3 edges/node) rather than a bare
  // tree — matching the reference's edge density.
  for (const siblings of childrenOfHub.values()) {
    if (siblings.length < 3) continue;
    for (const child of siblings) {
      const crossCount = 1 + Math.floor(rnd() * 2);
      for (let k = 0; k < crossCount; k++) {
        const other = siblings[Math.floor(rnd() * siblings.length)];
        if (other !== child) {
          links.push({ source: child, target: other, weight: 0.12 + rnd() * 0.28 });
        }
      }
    }
  }

  // Sparse cross-hub bridges — the faint long strands between constellations.
  const bridgeCount = Math.round(totalHubs * 6);
  for (let b = 0; b < bridgeCount; b++) {
    const a = raw[Math.floor(rnd() * raw.length)];
    const z = raw[Math.floor(rnd() * raw.length)];
    if (a.hubId !== z.hubId) {
      links.push({ source: a.id, target: z.id, weight: 0.12 + rnd() * 0.2 });
    }
  }

  // Hub backbone.
  for (let i = 0; i < hubIds.length; i++) {
    if (rnd() > 0.45) {
      links.push({ source: hubIds[i], target: pick(hubIds), weight: 0.5 + rnd() * 0.3 });
    }
  }

  const positions = computeRadialLayout(layoutInput);

  const nodes: LensNode[] = raw.map((n) => {
    const pos = positions.get(n.id)!;
    const isHub = n.tier === 0;
    const hubIndex = isHub ? Number(n.id.replace("hub-", "")) : -1;
    const isMajorHub = isHub && hubIndex >= 0 && hubIndex < hubCount;
    const accent = ACCENT_TYPES.includes(n.type) && rnd() > 0.86;
    return {
      id: n.id,
      label: n.label,
      type: n.type,
      hubId: n.hubId,
      x: pos.x,
      y: pos.y,
      val: isMajorHub ? 6.4 : isHub ? 3.2 : n.tier === 1 ? 2.15 : 1.35,
      accent,
      active: false,
    };
  });

  // Drop self-links, dangling links, and duplicate unordered pairs so the
  // edge count stays honest and lines don't overdraw.
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

  // Fill the constellation with irregular intra-family synapses. Deterministic
  // random pairing avoids the visible circular bands produced by linking
  // adjacent members of a radial fan.
  const membersByHub = new Map<string, typeof raw>();
  for (const node of raw) {
    const members = membersByHub.get(node.hubId) ?? [];
    members.push(node);
    membersByHub.set(node.hubId, members);
  }
  const families = [...membersByHub.values()];
  for (let pass = 0; cleanLinks.length < targetEdges && pass < 40; pass++) {
    for (const family of families) {
      for (const source of family) {
        if (cleanLinks.length >= targetEdges) break;
        const target = family[Math.floor(rnd() * family.length)];
        if (!target || target.id === source.id) continue;
        const key = source.id < target.id ? `${source.id}|${target.id}` : `${target.id}|${source.id}`;
        if (seen.has(key)) continue;
        seen.add(key);
        cleanLinks.push({
          source: source.id,
          target: target.id,
          weight: 0.08 + rnd() * 0.14,
        });
      }
    }
  }

  return {
    nodes,
    links: cleanLinks,
    meta: { demo: true, nodeCount: nodes.length, edgeCount: cleanLinks.length },
  };
}
