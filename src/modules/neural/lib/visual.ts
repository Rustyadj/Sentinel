import type {
  KnowledgeCluster,
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeObject,
} from "@/lib/knowledge-graph/types";

/**
 * Pure, deterministic mapping from canonical KnowledgeGraph data to the visual
 * attributes the galaxy draws. No rendering, no library imports — this is where
 * "node size from importance", "muted cluster tint", "edge width from weight",
 * and LOD/isolation live, so they can be reasoned about (and tested) in isolation.
 */

/** Near-black space background. */
export const SPACE_BG = "#05060a";

/**
 * Muted, low-saturation tints. Most of the graph is `neutral` (blue-gray white);
 * only meaningful clusters carry colour. No neon, no rainbow.
 */
const CLUSTER_RGB: Record<KnowledgeCluster, [number, number, number]> = {
  neutral: [188, 199, 214],
  green: [126, 168, 132],
  blue: [120, 150, 190],
  amber: [196, 170, 120],
  purple: [150, 132, 186],
};

export interface NeuralNode extends KnowledgeObject {
  degree: number;
  /** Precomputed nodeVal (sphere volume ∝ val). */
  size: number;
  // Runtime fields the force layout writes back:
  x?: number;
  y?: number;
  z?: number;
}

export interface NeuralLink {
  id: string;
  source: string | NeuralNode;
  target: string | NeuralNode;
  kind: KnowledgeEdge["kind"];
  weight: number;
  width: number;
}

export interface NeuralData {
  nodes: NeuralNode[];
  links: NeuralLink[];
}

function idOf(end: string | { id: string }): string {
  return typeof end === "string" ? end : end.id;
}

/** Count undirected degree per object id. */
export function degreeMap(edges: KnowledgeEdge[]): Map<string, number> {
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  return degree;
}

/**
 * nodeVal for react-force-graph: sphere radius ∝ cbrt(val), so cube the
 * significance to get radius roughly linear in significance. Significance blends
 * canonical importance with connectivity.
 */
export function nodeSize(obj: KnowledgeObject, degree: number): number {
  const connectivity = Math.min(1, degree / 14);
  const significance = obj.importance * 0.72 + connectivity * 0.5;
  const s = 0.5 + significance * 2.4;
  return s * s * s;
}

/** Blend the cluster tint toward neutral so tints stay muted. */
export function nodeColor(obj: KnowledgeObject): string {
  const [r, g, b] = CLUSTER_RGB[obj.cluster];
  // Hubs read a touch brighter; leaf nodes a touch dimmer — never saturated.
  const lift =
    obj.kind === "project" ? 1.12 : obj.kind === "agent" ? 1.06 : 0.92;
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v * lift)));
  return `rgb(${clamp(r)}, ${clamp(g)}, ${clamp(b)})`;
}

/**
 * Translucent edges. Retrieval paths and the strands touching an active node
 * are drawn a little brighter, but nothing gets a permanent glow.
 */
export function edgeColor(link: NeuralLink, highlighted: boolean): string {
  if (highlighted) return "rgba(180, 205, 235, 0.55)";
  const base = link.kind === "membership" ? 0.14 : 0.09;
  const alpha = base + link.weight * 0.1;
  return `rgba(150, 170, 200, ${alpha.toFixed(3)})`;
}

export function edgeWidth(weight: number): number {
  return 0.18 + weight * 1.1;
}

/** Map canonical graph → mutable render data with degree & size precomputed. */
export function buildNeuralData(graph: KnowledgeGraph): NeuralData {
  const degree = degreeMap(graph.edges);
  const nodes: NeuralNode[] = graph.objects.map((o) => {
    const d = degree.get(o.id) ?? 0;
    return { ...o, degree: d, size: nodeSize(o, d) };
  });
  const present = new Set(nodes.map((n) => n.id));
  const links: NeuralLink[] = graph.edges
    .filter((e) => present.has(e.source) && present.has(e.target))
    .map((e) => ({
      id: e.id,
      source: e.source,
      target: e.target,
      kind: e.kind,
      weight: e.weight,
      width: edgeWidth(e.weight),
    }));
  return { nodes, links };
}

/**
 * Level-of-detail cap: keep the most significant objects (active nodes and any
 * `keepIds` are always retained), then edges among the survivors. Keeps the
 * scene readable and the frame-rate up on large graphs.
 */
export function selectVisible(
  graph: KnowledgeGraph,
  cap: number,
  keepIds: string[] = [],
): KnowledgeGraph {
  if (graph.objects.length <= cap) return graph;

  const keep = new Set<string>(keepIds);
  for (const o of graph.objects) {
    if (o.active) keep.add(o.id);
  }

  const rest = graph.objects
    .filter((o) => !keep.has(o.id))
    .sort((a, b) => b.importance - a.importance);

  for (const o of rest) {
    if (keep.size >= cap) break;
    keep.add(o.id);
  }

  const objects = graph.objects.filter((o) => keep.has(o.id));
  const edges = graph.edges.filter(
    (e) => keep.has(e.source) && keep.has(e.target),
  );
  return { objects, edges, meta: graph.meta };
}

/**
 * Isolate the local cluster around a focus object: everything reachable within
 * `depth` hops (undirected). Powers double-click-to-isolate and Local Cluster mode.
 */
export function localCluster(
  graph: KnowledgeGraph,
  focusId: string,
  depth = 1,
): KnowledgeGraph {
  const adjacency = new Map<string, Set<string>>();
  for (const e of graph.edges) {
    if (!adjacency.has(e.source)) adjacency.set(e.source, new Set());
    if (!adjacency.has(e.target)) adjacency.set(e.target, new Set());
    adjacency.get(e.source)!.add(e.target);
    adjacency.get(e.target)!.add(e.source);
  }

  const keep = new Set<string>([focusId]);
  let frontier = new Set<string>([focusId]);
  for (let d = 0; d < depth; d++) {
    const next = new Set<string>();
    for (const id of frontier) {
      for (const nb of adjacency.get(id) ?? []) {
        if (!keep.has(nb)) {
          keep.add(nb);
          next.add(nb);
        }
      }
    }
    frontier = next;
    if (frontier.size === 0) break;
  }

  const objects = graph.objects.filter((o) => keep.has(o.id));
  const edges = graph.edges.filter(
    (e) => keep.has(e.source) && keep.has(e.target),
  );
  return { objects, edges, meta: graph.meta };
}

/** Edge ids whose endpoints touch any of the given node ids. */
export function incidentEdgeIds(
  links: NeuralLink[],
  nodeIds: Set<string>,
): Set<string> {
  const out = new Set<string>();
  for (const l of links) {
    if (nodeIds.has(idOf(l.source)) || nodeIds.has(idOf(l.target))) {
      out.add(l.id);
    }
  }
  return out;
}
