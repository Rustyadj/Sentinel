import { db } from "@/lib/db";
import { buildRetrievalFilters } from "./retrieval";
import { resolveMemoryScopeAccess } from "./memory-scope";
import { rankMemories } from "./retrieval-ranking";
import { operationalMetadata } from "./operational-types";
import { requireOperationalAccess } from "./operational-ingestion";
import { embed, getEmbeddingProvider } from "@/lib/neural-engine/embeddings";
import { findSimilar, provenanceOf } from "@/lib/neural-engine/embedding-store";
import { recordMemoryRetrieval } from "@/lib/neural-engine/memory-usage-service";
import type { RetrievalContext } from "./types";

/** Ranking extension of the existing memory retrieval, never an alternate memory store. */
export async function incidentMemoryCandidates(ctx: RetrievalContext) {
  if (!ctx.workspaceId) return { memories: [], incidents: [], partial: false, semanticAvailable: false };
  await requireOperationalAccess(ctx.userId, ctx.workspaceId);
  const access = await resolveMemoryScopeAccess(ctx.userId, ctx.workspaceId);
  const filter = buildRetrievalFilters(ctx, access).memory;
  const objects = await db.knowledgeObject.findMany({ where: { workspaceId: ctx.workspaceId, type: "Incident", sourceType: { startsWith: "operational:" }, validTo: null }, orderBy: { updatedAt: "desc" }, take: 501 });
  const pool = objects.slice(0, 500);
  const memoryIds = pool.flatMap(object => operationalMetadata(object.metadata)?.memoryId ?? []);
  const memories = memoryIds.length ? await db.memory.findMany({ where: { AND: [filter, { id: { in: memoryIds }, workspaceId: ctx.workspaceId }] }, take: 500 }) : [];
  return { memories, incidents: pool, partial: objects.length > 500, semanticAvailable: false };
}

export async function operationalMemorySignals(ctx: RetrievalContext, memories: Awaited<ReturnType<typeof incidentMemoryCandidates>>["memories"]) {
  const signals = new Map<string, { semantic: number; graph: number }>();
  if (!ctx.workspaceId || !ctx.query || !memories.length) return signals;
  const services = await db.knowledgeObject.findMany({ where: { workspaceId: ctx.workspaceId, type: "Service", validTo: null }, take: 200 });
  const matches = services.filter(service => ctx.query!.toLowerCase().includes(service.title.toLowerCase()));
  const tags = new Set(memories.flatMap(memory => memory.tags));
  const edges = matches.length ? await db.knowledgeEdge.findMany({ where: { fromObjectId: { in: matches.map(service => service.id) }, toObjectId: { in: [...tags] }, type: "SERVICE_AFFECTED_BY_INCIDENT" }, take: 2000 }) : [];
  const connected = new Set(edges.map(edge => edge.toObjectId));
  for (const memory of memories) signals.set(memory.id, { semantic: 0, graph: memory.tags.some(tag => connected.has(tag)) ? 1 : 0 });
  const provider = getEmbeddingProvider();
  if (provider) {
    const vector = await embed([ctx.query]);
    if (vector?.vectors[0]) {
      try {
        for (const item of await findSimilar(vector.vectors[0], provenanceOf(provider), memories.map(memory => memory.id), 500)) signals.get(item.memoryId)!.semantic = Math.max(0, 1 - item.distance);
      } catch { /* Explicitly absent semantic factors; lexical and graph retrieval remain usable. */ }
    }
  }
  return signals;
}

export async function retrieveIncidentHistory(ctx: RetrievalContext & { query: string; workspaceId: string }, options: { serviceId?: string; from?: Date; to?: Date; latest?: boolean } = {}) {
  const candidates = await incidentMemoryCandidates(ctx);
  const allowed = new Map(candidates.memories.map(memory => [memory.id, memory]));
  const ids = candidates.incidents.filter(object => allowed.has(operationalMetadata(object.metadata)?.memoryId ?? "")).map(object => object.id);
  const services = await db.knowledgeObject.findMany({ where: { workspaceId: ctx.workspaceId, type: "Service", validTo: null, ...(options.serviceId ? { id: options.serviceId } : {}) }, take: 200 });
  if (options.serviceId && !services.length) throw new Error("Service not found");
  const terms = ctx.query.toLowerCase();
  const matched = services.filter(service => options.serviceId ? service.id === options.serviceId : terms.includes(service.title.toLowerCase()));
  const edges = ids.length ? await db.knowledgeEdge.findMany({ where: { type: "SERVICE_AFFECTED_BY_INCIDENT", fromObjectId: { in: matched.map(service => service.id) }, toObjectId: { in: ids } }, take: 2000 }) : [];
  const connected = new Set(edges.map(edge => edge.toObjectId));
  const signals = await operationalMemorySignals(ctx, candidates.memories);
  const semantic = new Map([...signals].filter(([, signal]) => signal.semantic > 0).map(([id, signal]) => [id, signal.semantic]));
  const lexical = new Map(rankMemories(ctx.query, candidates.memories, { limit: 500, temporalIntent: "historical" }).map(item => [item.memory.id, item.score]));
  const results = candidates.incidents.flatMap(object => {
    const meta = operationalMetadata(object.metadata)!;
    const memory = meta.memoryId ? allowed.get(meta.memoryId) : undefined;
    if (!memory || (matched.length && !connected.has(object.id))) return [];
    const at = Date.parse(meta.facts.startedAt ?? meta.eventTime);
    if ((options.from && at < options.from.getTime()) || (options.to && at > options.to.getTime())) return [];
    const lexicalScore = lexical.get(memory.id) ?? 0;
    const semanticScore = semantic.get(memory.id) ?? 0;
    if (!connected.has(object.id) && lexicalScore < 1 && semanticScore < 0.5) return [];
    const resolutionMs = meta.facts.resolvedAt && meta.facts.startedAt ? Date.parse(meta.facts.resolvedAt) - Date.parse(meta.facts.startedAt) : null;
    const score = lexicalScore + semanticScore * 5 + (connected.has(object.id) ? 3 : 0);
    return [{ id: object.id, title: object.title, memoryId: memory.id, content: memory.content, eventTime: meta.eventTime, startedAt: meta.facts.startedAt ?? null, resolvedAt: meta.facts.resolvedAt ?? null, resolutionMs, rootCause: meta.facts.rootCauseConfirmed ? meta.facts.rootCause ?? null : null, evidence: meta.evidence, source: meta.source, sourceId: meta.sourceId, confidence: memory.confidence, uncertainty: [!meta.facts.rootCauseConfirmed ? "Root cause unconfirmed" : null, !semantic.size ? "Semantic embeddings unavailable; lexical and graph signals used" : null].filter(Boolean), score, factors: { lexical: lexicalScore, semantic: semanticScore, graph: connected.has(object.id) ? 1 : 0 }, at }];
  });
  const latest = options.latest ?? /\b(last|latest|most recent)\b/i.test(ctx.query);
  results.sort((a, b) => latest ? b.at - a.at || b.score - a.score : b.score - a.score || b.at - a.at);
  const incidents = results.slice(0, Math.min(Math.max(ctx.maxItems ?? 3, 1), 20));
  const connections = incidents.length ? await db.knowledgeEdge.findMany({ where: { OR: [{ fromObjectId: { in: incidents.map(item => item.id) } }, { toObjectId: { in: incidents.map(item => item.id) } }] }, take: 400 }) : [];
  const neighbours = await db.knowledgeObject.findMany({ where: { workspaceId: ctx.workspaceId, id: { in: [...new Set(connections.flatMap(edge => [edge.fromObjectId, edge.toObjectId]))] }, type: { in: ["Agent", "Person", "Action", "Resolution"] } }, take: 400 });
  const enriched = incidents.map(incident => {
    const ids = new Set(connections.filter(edge => edge.fromObjectId === incident.id || edge.toObjectId === incident.id).flatMap(edge => [edge.fromObjectId, edge.toObjectId]));
    const related = neighbours.filter(node => ids.has(node.id)).map(node => ({ id: node.id, type: node.type, title: node.title, summary: node.summary, outcome: operationalMetadata(node.metadata)?.facts.outcome ?? "unknown", evidence: operationalMetadata(node.metadata)?.evidence ?? [] }));
    return { ...incident, responders: related.filter(node => ["Agent", "Person"].includes(node.type)), actions: related.filter(node => node.type === "Action"), resolutions: related.filter(node => node.type === "Resolution"), confidenceMeaning: "Memory admission heuristic; factual confidence is not calibrated" };
  });
  await recordMemoryRetrieval({ memoryIds: incidents.map(item => item.memoryId), injected: [], consumer: "mcp", userId: ctx.userId, workspaceId: ctx.workspaceId });
  return { incidents: enriched, partial: connections.length === 400 || neighbours.length === 400 || candidates.partial || services.length === 200 || edges.length === 2000, semanticAvailable: semantic.size > 0 };
}
