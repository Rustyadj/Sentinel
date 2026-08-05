// Neural Lens — shared view types (Phase E: OS-scale graph).

import type { ClusterOutline } from "./radialLayout";
import type { ClusterId, NodeCategory } from "./categories";

export type LensId = "Knowledge" | "Execution" | "People";

export type { ClusterId, NodeCategory };

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
  /** One of the ~10 OS-level regions (Chat, Projects, Knowledge, …). */
  clusterId: ClusterId;
  /** True for the small set of tinted accent nodes (memory/decision/agent…). */
  accent?: boolean;
  /** True for hub-eligible categories (Workspace, Project, Agent, …) — larger
   * radius, soft glow, other nodes fan out from them. */
  isHub?: boolean;
  /** True when this hub is the currently-active lens target — renders purple
   * per the "lens hub" node state, distinct from a plain structural hub. */
  isLensHub?: boolean;
  /** Live-active (recently touched by a stream event) — pulses. */
  active?: boolean;
  /** True while this node sits on the currently-animating execution path. */
  onExecutionPath?: boolean;
  /** Owning workspace, when known — drives the focus/neighborhood highlight color. */
  workspaceId?: string;
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
  /** Cluster bounding circles for the zoomed-out outline view — present once
   * the graph has been laid out with computeClusteredRadialLayout. */
  clusterOutlines?: ClusterOutline[];
}

/**
 * Five-level semantic zoom, keyed to camera distance:
 *   galaxy       — tiny dots, no labels, cluster outlines only
 *   cluster      — cluster names, major hubs
 *   region       — departments/projects/agents/repositories
 *   neighborhood — files/memories/workflows/tasks
 *   detail       — individual entities, properties, relationships
 */
export type SemanticZoomLevel = "galaxy" | "cluster" | "region" | "neighborhood" | "detail";

/** An ordered chain of node ids representing one active execution — e.g. User
 * → Claude Code → Repository → Files → Tests → Commit → Deployment. Only the
 * edges along this path animate; the rest of the graph stays still. */
export interface ExecutionPath {
  id: string;
  nodeIds: string[];
  startedAt: number;
}
