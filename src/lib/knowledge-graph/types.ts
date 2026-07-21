/**
 * Canonical knowledge-graph domain.
 *
 * KnowledgeObject / KnowledgeEdge are the source of truth for what the
 * Neural Space renders. The renderer is a pure visualization layer over these
 * — it must never hold canonical state. Everything the galaxy draws (node size,
 * cluster tint, edge width, pulse) is derived from fields defined here.
 */

/** What a node represents in the org's knowledge. */
export type KnowledgeObjectKind =
  | "concept"
  | "document"
  | "memory"
  | "agent"
  | "project"
  | "decision"
  | "message";

/**
 * Muted colour family a node belongs to. Most of the graph is `neutral`
 * (white / blue-gray); only meaningful clusters get a low-saturation tint.
 * Deliberately a small, muted set — no rainbow.
 */
export type KnowledgeCluster = "neutral" | "green" | "blue" | "amber" | "purple";

export interface KnowledgeObject {
  id: string;
  kind: KnowledgeObjectKind;
  label: string;
  /** Muted colour family. */
  cluster: KnowledgeCluster;
  /** 0..1 — canonical significance, drives node size (independent of degree). */
  importance: number;
  /** Grouping key used for LOD collapsing and local-cluster isolation. */
  clusterId?: string;
  /** Live-active (e.g. an agent currently working). Drives the soft pulse. */
  active?: boolean;
}

export type KnowledgeEdgeKind =
  | "reference" // wiki-link / citation between documents or concepts
  | "membership" // project → contained object
  | "authored" // agent → decision / memory it produced
  | "derivation" // decision → memory / document it drew from
  | "retrieval"; // transient path lit up during a retrieval

export interface KnowledgeEdge {
  id: string;
  source: string;
  target: string;
  kind: KnowledgeEdgeKind;
  /** 0..1 — relationship strength, drives edge width and opacity. */
  weight: number;
}

export interface KnowledgeGraphMeta {
  /** True when the payload is generated sample data rather than DB-projected. */
  sample?: boolean;
  source?: "db" | "sample";
  generatedAt?: string;
}

export interface KnowledgeGraph {
  objects: KnowledgeObject[];
  edges: KnowledgeEdge[];
  meta?: KnowledgeGraphMeta;
}
