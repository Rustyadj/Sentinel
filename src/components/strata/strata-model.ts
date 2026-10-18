// Lays the real knowledge graph out as four stacked strata: agents on top,
// then the projects they serve, the tasks inside those, and the memory and
// knowledge everything rests on. Positions are a pure function of the graph —
// the same graph always produces the same picture, and nothing here is
// generated to fill space.

import type { GlobeModel } from "@/components/orrery/globe-model";

export type StratumId = "agents" | "projects" | "tasks" | "memory";

export interface Stratum {
  id: StratumId;
  label: string;
  /** CSS custom property holding the stratum's pigment. */
  token: string;
  /** Fallback hex for canvas drawing when the token cannot be read. */
  hex: string;
}

export const STRATA: readonly Stratum[] = [
  { id: "agents", label: "Agents", token: "--entity-agent", hex: "#86a9e8" },
  { id: "projects", label: "Projects", token: "--entity-project", hex: "#74c2ab" },
  { id: "tasks", label: "Tasks", token: "--entity-task", hex: "#e7926f" },
  { id: "memory", label: "Memory", token: "--entity-memory", hex: "#b9a0e6" },
];

/**
 * Which stratum a KnowledgeObject type belongs to. Types the product does not
 * name here settle into memory, the layer of things that are known rather
 * than acted on.
 */
const TYPE_STRATUM: Record<string, number> = {
  // Who acts.
  Agent: 0, Person: 0, Organization: 0, Runtime: 0, Model: 0, Provider: 0,
  // What they act for.
  Project: 1, Goal: 1, LearningGoal: 1, Workspace: 1, Repository: 1, Module: 1, Conversation: 1,
  Campaign: 1, MarketingCampaign: 1,
  // The work itself.
  Task: 2, Approval: 2, Workflow: 2, WorkflowRun: 2, Artifact: 2, Branch: 2, Commit: 2, Experiment: 2,
  LearningCandidate: 2, Benchmark: 2, EvalCase: 2, EvalSuite: 2, AdversarialRun: 2, Detection: 2,
  Lead: 2, Content: 2, Message: 2,
  // What is known.
  Memory: 3, Note: 3, Decision: 3, Knowledge: 3, File: 3, Skill: 3, Lesson: 3, Principle: 3, Reflection: 3,
  Failure: 3, KnowledgeGap: 3, CuriosityEvent: 3, TrustEvent: 3, GuardianDecision: 3, LearningEvent: 3,
  CyberAsset: 3, Threat: 3,
};

export function stratumOf(type: string): number {
  return TYPE_STRATUM[type] ?? 3;
}

export interface StrataModel {
  nodeCount: number;
  edgeCount: number;
  ids: string[];
  labels: string[];
  types: string[];
  /** Stratum index per node, 0 = agents. */
  layer: Uint8Array;
  /** Position on the stratum plane, both in [-1, 1]. */
  u: Float32Array;
  v: Float32Array;
  isHub: Uint8Array;
  edges: Uint32Array;
  adjacency: number[][];
  indexById: Map<string, number>;
  /** Node count per stratum. */
  counts: [number, number, number, number];
}

/** FNV-1a — stable across sessions and machines, which is the point. */
function hash(text: string, seed = 2166136261): number {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

const unit = (h: number) => (h % 100000) / 100000;

/** A point in the unit disc derived from the id, area-uniform so strata do not crowd at the centre. */
function seat(id: string): [number, number] {
  const r = Math.sqrt(unit(hash(id))) * 0.86;
  const a = unit(hash(id, 40503)) * Math.PI * 2;
  return [Math.cos(a) * r, Math.sin(a) * r];
}

export function toStrataModel(graph: GlobeModel): StrataModel {
  const n = graph.nodeCount;
  const layer = new Uint8Array(n);
  const u = new Float32Array(n);
  const v = new Float32Array(n);
  const counts: [number, number, number, number] = [0, 0, 0, 0];

  for (let i = 0; i < n; i++) {
    layer[i] = stratumOf(graph.types[i]);
    counts[layer[i]]++;
    const [su, sv] = seat(graph.ids[i]);
    u[i] = su;
    v[i] = sv;
  }

  // Top-down, each node leans toward the things above it that it is connected
  // to, so a project sits beneath its agents and a task beneath its project.
  // The threads between strata then fall roughly vertically and read as
  // lineage instead of noise.
  for (let s = 1; s < 4; s++) {
    for (let i = 0; i < n; i++) {
      if (layer[i] !== s) continue;
      let mu = 0, mv = 0, k = 0;
      for (const j of graph.adjacency[i]) {
        if (layer[j] < s) { mu += u[j]; mv += v[j]; k++; }
      }
      if (!k) continue;
      const jitter = 0.09 + 0.06 * unit(hash(graph.ids[i], 977));
      const angle = unit(hash(graph.ids[i], 1297)) * Math.PI * 2;
      u[i] = 0.35 * u[i] + 0.65 * (mu / k) + Math.cos(angle) * jitter;
      v[i] = 0.35 * v[i] + 0.65 * (mv / k) + Math.sin(angle) * jitter;
      const r = Math.hypot(u[i], v[i]);
      if (r > 0.92) { u[i] *= 0.92 / r; v[i] *= 0.92 / r; }
    }
  }

  return {
    nodeCount: n,
    edgeCount: graph.edgeCount,
    ids: graph.ids,
    labels: graph.labels,
    types: graph.types,
    layer, u, v,
    isHub: graph.isHub,
    edges: graph.edges,
    adjacency: graph.adjacency,
    indexById: graph.indexById,
    counts,
  };
}
