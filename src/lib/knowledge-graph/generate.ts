import type {
  KnowledgeCluster,
  KnowledgeEdge,
  KnowledgeEdgeKind,
  KnowledgeGraph,
  KnowledgeObject,
  KnowledgeObjectKind,
} from "./types";

/** Small deterministic PRNG so the sample galaxy is stable across renders. */
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

const TINTS: KnowledgeCluster[] = ["green", "blue", "amber", "purple"];

const MEMBER_KINDS: KnowledgeObjectKind[] = [
  "document",
  "concept",
  "memory",
  "decision",
  "message",
];

interface GenerateOptions {
  seed?: number;
  /** Total object count target. The reference image is ~800 nodes. */
  objectCount?: number;
  /** Number of thematic clusters. */
  clusterCount?: number;
}

/**
 * Deterministically build a dense, realistic knowledge graph: a handful of
 * cluster hubs, each with a hub-and-spoke neighbourhood, plus sparse
 * cross-cluster bridges — the hairball topology of the reference. Most nodes
 * stay neutral; only a few clusters are tinted, and only a few agents are
 * active. Used as canonical sample data when the DB is sparse and for the
 * standalone Neural Focus experience.
 */
export function generateKnowledgeGraph(options: GenerateOptions = {}): KnowledgeGraph {
  const {
    seed = 1312,
    objectCount = 720,
    clusterCount = 14,
  } = options;

  const rnd = mulberry32(seed);
  const pick = <T>(arr: T[]): T => arr[Math.floor(rnd() * arr.length)];

  const objects: KnowledgeObject[] = [];
  const edges: KnowledgeEdge[] = [];
  const clusterHubs: string[] = [];
  const clusterMembers: Record<string, string[]> = {};

  // Roughly a third of clusters carry a muted tint; the rest are neutral.
  const tintedCount = Math.max(3, Math.round(clusterCount * 0.35));

  for (let c = 0; c < clusterCount; c++) {
    const clusterId = `cluster-${c}`;
    const cluster: KnowledgeCluster =
      c < tintedCount ? TINTS[c % TINTS.length] : "neutral";

    const hubId = `${clusterId}-hub`;
    objects.push({
      id: hubId,
      kind: "project",
      label: `Cluster ${c + 1}`,
      cluster,
      clusterId,
      importance: 0.82 + rnd() * 0.18,
    });
    clusterHubs.push(hubId);
    clusterMembers[clusterId] = [];
  }

  // Distribute the remaining objects across clusters with a long-tailed size
  // so some clusters are dense and some are sparse (like the reference).
  const remaining = objectCount - clusterHubs.length;
  let created = 0;
  let idx = 0;
  while (created < remaining) {
    const c = Math.floor(rnd() ** 1.7 * clusterCount); // bias toward low indices
    const clusterId = `cluster-${Math.min(c, clusterCount - 1)}`;
    const hub = objects.find((o) => o.id === `${clusterId}-hub`)!;
    const kind = pick(MEMBER_KINDS);
    const id = `obj-${idx++}`;

    objects.push({
      id,
      kind: kind === "message" && rnd() > 0.85 ? "agent" : kind,
      label: `${labelFor(kind)} ${idx}`,
      cluster: hub.cluster,
      clusterId,
      importance: 0.12 + rnd() ** 2 * 0.5,
    });
    clusterMembers[clusterId].push(id);
    created++;
  }

  // A few agents scattered in the field are "active" and will pulse.
  const agentPool = objects.filter((o) => o.kind === "agent");
  for (let i = 0; i < agentPool.length; i++) {
    if (rnd() > 0.7) {
      agentPool[i].active = true;
      agentPool[i].kind = "agent";
      agentPool[i].importance = Math.max(agentPool[i].importance, 0.55);
    }
  }

  let edgeId = 0;
  const addEdge = (
    source: string,
    target: string,
    kind: KnowledgeEdgeKind,
    weight: number,
  ) => {
    if (source === target) return;
    edges.push({ id: `e-${edgeId++}`, source, target, kind, weight });
  };

  // Hub-and-spoke within each cluster, plus a few intra-cluster peer links.
  for (const clusterId of Object.keys(clusterMembers)) {
    const hubId = `${clusterId}-hub`;
    const members = clusterMembers[clusterId];
    for (const m of members) {
      addEdge(hubId, m, "membership", 0.4 + rnd() * 0.4);
      // Sparse peer references give the cluster internal structure.
      if (members.length > 3 && rnd() > 0.55) {
        addEdge(m, pick(members), "reference", 0.15 + rnd() * 0.4);
      }
    }
  }

  // Sparse cross-cluster bridges — the strands that hold the galaxy together.
  const bridgeCount = Math.round(clusterCount * 6);
  for (let b = 0; b < bridgeCount; b++) {
    const a = pick(objects);
    const z = pick(objects);
    if (a.clusterId !== z.clusterId) {
      addEdge(a.id, z.id, "derivation", 0.1 + rnd() * 0.35);
    }
  }

  // Hub-to-hub backbone.
  for (let i = 0; i < clusterHubs.length; i++) {
    if (rnd() > 0.4) {
      addEdge(clusterHubs[i], pick(clusterHubs), "reference", 0.5 + rnd() * 0.4);
    }
  }

  return {
    objects,
    edges,
    meta: { sample: true, source: "sample", generatedAt: new Date(0).toISOString() },
  };
}

function labelFor(kind: KnowledgeObjectKind): string {
  switch (kind) {
    case "document":
      return "Document";
    case "concept":
      return "Concept";
    case "memory":
      return "Memory";
    case "decision":
      return "Decision";
    case "agent":
      return "Agent";
    default:
      return "Node";
  }
}
