// Adapts the real graph (LensGraph, built from /api/graph) into the flat,
// index-based model the canvas renderer iterates every frame. Positions come
// from the shared deterministic globe layout; nothing is generated here.

import { CLUSTER_IDS, CLUSTER_LABEL, CORE_CLUSTER_ID } from "@/components/neural-lens/categories";
import { CLUSTER_COLORS } from "@/components/neural-lens/palette";
import type { LensGraph } from "@/components/neural-lens/types";

export type RGB = readonly [number, number, number];
export interface Vec3 { x: number; y: number; z: number }

export function hexToRgb(hex: string): RGB {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}
export const rgba = (c: RGB, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a})`;
export const mix = (a: RGB, b: RGB, t: number): RGB =>
  [0, 1, 2].map((k) => Math.round(a[k] + (b[k] - a[k]) * t)) as unknown as RGB;

/** The layout works in a 1000-unit shell; the renderer works on the unit sphere. */
const LAYOUT_RADIUS = 1000;
const NEUTRAL: RGB = hexToRgb("#95a9cc");

export interface GlobeRegion {
  index: number;
  id: string;
  label: string;
  color: string;
  rgb: RGB;
  tint: RGB;
  core: boolean;
  anchor: Vec3;
  nodeCount: number;
}

export interface GlobeModel {
  nodeCount: number;
  edgeCount: number;
  ids: string[];
  labels: string[];
  types: string[];
  x: Float32Array;
  y: Float32Array;
  z: Float32Array;
  region: Uint8Array;
  isHub: Uint8Array;
  /** Edge endpoints as node indices, pairs. */
  edges: Uint32Array;
  /** Edge relationship weight, 0..1. */
  edgeWeight: Float32Array;
  regions: GlobeRegion[];
  indexById: Map<string, number>;
  /** Neighbour node indices per node. */
  adjacency: number[][];
}

/** The layout adapter adds placeholder hubs ("Unclustered") so loose nodes have
 * something to hang from. They are layout scaffolding, not Sentinel data. */
const isScaffold = (id: string) => id.startsWith("__orphans__:");

export function toGlobeModel(layout: LensGraph): GlobeModel {
  const graph = {
    ...layout,
    nodes: layout.nodes.filter((n) => !isScaffold(n.id)),
    links: layout.links.filter((l) => !isScaffold(l.source) && !isScaffold(l.target)),
  };
  const indexById = new Map<string, number>();
  graph.nodes.forEach((n, i) => indexById.set(n.id, i));
  const counts = new Map<string, number>();
  for (const n of graph.nodes) counts.set(n.clusterId, (counts.get(n.clusterId) ?? 0) + 1);

  const regions: GlobeRegion[] = CLUSTER_IDS.map((id, index) => {
    const rgb = hexToRgb(CLUSTER_COLORS[id]);
    const layoutRegion = graph.regions?.find((r) => r.clusterId === id);
    const core = id === CORE_CLUSTER_ID;
    return {
      index, id, label: CLUSTER_LABEL[id], color: CLUSTER_COLORS[id], rgb, tint: mix(NEUTRAL, rgb, 0.5), core,
      anchor: core || !layoutRegion
        ? { x: 0, y: 0, z: 1 }
        : { x: layoutRegion.nx, y: layoutRegion.ny, z: layoutRegion.nz },
      nodeCount: counts.get(id) ?? 0,
    };
  });

  const n = graph.nodes.length;
  const x = new Float32Array(n), y = new Float32Array(n), z = new Float32Array(n);
  const region = new Uint8Array(n), isHub = new Uint8Array(n);
  graph.nodes.forEach((node, i) => {
    x[i] = node.x / LAYOUT_RADIUS; y[i] = node.y / LAYOUT_RADIUS; z[i] = node.z / LAYOUT_RADIUS;
    region[i] = Math.max(0, CLUSTER_IDS.indexOf(node.clusterId));
    isHub[i] = node.isHub ? 1 : 0;
  });

  const pairs: number[] = [], weights: number[] = [];
  const adjacency: number[][] = Array.from({ length: n }, () => []);
  for (const link of graph.links) {
    const a = indexById.get(link.source), b = indexById.get(link.target);
    if (a === undefined || b === undefined) continue;
    pairs.push(a, b); weights.push(link.weight);
    adjacency[a].push(b); adjacency[b].push(a);
  }

  return {
    nodeCount: n, edgeCount: weights.length,
    ids: graph.nodes.map((nd) => nd.id), labels: graph.nodes.map((nd) => nd.label), types: graph.nodes.map((nd) => nd.type),
    x, y, z, region, isHub,
    edges: Uint32Array.from(pairs), edgeWeight: Float32Array.from(weights),
    regions, indexById, adjacency,
  };
}
