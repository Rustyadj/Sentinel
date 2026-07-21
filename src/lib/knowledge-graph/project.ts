// Server-only: imports the Prisma client. Never import from a Client Component.
import { db } from "@/lib/db";
import type {
  KnowledgeCluster,
  KnowledgeEdge,
  KnowledgeGraph,
  KnowledgeObject,
} from "./types";

/** Rotating muted tints assigned per-project so each project reads as a cluster. */
const PROJECT_TINTS: KnowledgeCluster[] = ["blue", "green", "purple", "amber"];

/**
 * Project the persisted canonical entities (projects, notes, agents, memories)
 * into a unified KnowledgeGraph. This is the real, DB-backed knowledge graph;
 * the Neural Space renders it without owning any of it.
 *
 * Importance is seeded from each object's kind and later reinforced by degree
 * (computed once edges are known), so hubs with many connections grow larger.
 */
export async function projectKnowledgeGraph(): Promise<KnowledgeGraph> {
  const [projects, notes, agents, memories] = await Promise.all([
    db.project.findMany({ select: { id: true, name: true } }),
    db.obsidianNote.findMany({
      select: { id: true, title: true, backlinks: true, projectId: true },
    }),
    db.agent.findMany({ select: { id: true, name: true, status: true } }),
    db.memory.findMany({
      select: { id: true, content: true, importanceScore: true, owner: true },
      take: 500,
    }),
  ]);

  const objects: KnowledgeObject[] = [];
  const edges: KnowledgeEdge[] = [];
  const known = new Set<string>();

  const clusterOf = new Map<string, KnowledgeCluster>();
  projects.forEach((p, i) => {
    const cluster = PROJECT_TINTS[i % PROJECT_TINTS.length];
    clusterOf.set(p.id, cluster);
    const id = `project-${p.id}`;
    objects.push({
      id,
      kind: "project",
      label: p.name,
      cluster,
      clusterId: p.id,
      importance: 0.85,
    });
    known.add(id);
  });

  for (const n of notes) {
    const cluster = n.projectId
      ? clusterOf.get(n.projectId) ?? "neutral"
      : "neutral";
    objects.push({
      id: n.id,
      kind: "document",
      label: n.title,
      cluster,
      clusterId: n.projectId ?? undefined,
      importance: 0.3,
    });
    known.add(n.id);
  }

  for (const a of agents) {
    const id = `agent-${a.id}`;
    objects.push({
      id,
      kind: "agent",
      label: a.name,
      cluster: "amber",
      clusterId: "agents",
      importance: 0.6,
      active: a.status === "busy" || a.status === "online",
    });
    known.add(id);
  }

  for (const m of memories) {
    const id = `memory-${m.id}`;
    objects.push({
      id,
      kind: "memory",
      label: m.content.slice(0, 48),
      cluster: "green",
      clusterId: m.owner,
      importance: 0.2 + Math.min(0.5, m.importanceScore ?? 0.3),
    });
    known.add(id);
  }

  let edgeId = 0;
  const addEdge = (
    source: string,
    target: string,
    kind: KnowledgeEdge["kind"],
    weight: number,
  ) => {
    if (source === target || !known.has(source) || !known.has(target)) return;
    edges.push({ id: `e-${edgeId++}`, source, target, kind, weight });
  };

  for (const n of notes) {
    for (const backlinkId of n.backlinks) {
      addEdge(backlinkId, n.id, "reference", 0.5);
    }
    if (n.projectId) {
      addEdge(`project-${n.projectId}`, n.id, "membership", 0.4);
    }
  }

  // Reinforce importance by degree so well-connected nodes render larger.
  const degree = new Map<string, number>();
  for (const e of edges) {
    degree.set(e.source, (degree.get(e.source) ?? 0) + 1);
    degree.set(e.target, (degree.get(e.target) ?? 0) + 1);
  }
  const maxDegree = Math.max(1, ...degree.values());
  for (const o of objects) {
    const d = (degree.get(o.id) ?? 0) / maxDegree;
    o.importance = Math.min(1, o.importance * 0.7 + d * 0.5);
  }

  return {
    objects,
    edges,
    meta: { sample: false, source: "db", generatedAt: new Date().toISOString() },
  };
}
