// Neural Lens — shared view types (Phase D).

export type LensId = "Knowledge" | "Execution" | "People";

/** A graph node as the Neural Lens renders it (view model, not canonical). */
export interface LensNode {
  id: string;
  label: string;
  type: string;
  /** Draw radius weight. */
  val: number;
  /** Fixed radial-layout position. */
  x: number;
  y: number;
  /** Cluster/hub this node belongs to (for LOD collapsing + coloring). */
  hubId: string;
  /** True for the small set of tinted accent nodes (memory/decision/agent…). */
  accent?: boolean;
  /** Live-active (recently touched by a stream event) — pulses. */
  active?: boolean;
}

export interface LensLink {
  source: string;
  target: string;
  /** 0..1 relationship weight → width/opacity. */
  weight: number;
}

export interface LensGraph {
  nodes: LensNode[];
  links: LensLink[];
  meta: { demo: boolean; nodeCount: number; edgeCount: number };
}
