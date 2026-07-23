import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { estimateTokens } from "./active-memory";
import { emitAdaptiveEvent } from "./event-service";
import { requireAdaptiveScope } from "./scope";

export const RETRIEVAL_SCORING_VERSION = "adaptive-hybrid-v1";
const weights = {
  semantic: 0.22, keyword: 0.18, graph: 0.08, scope: 0.12,
  recency: 0.07, importance: 0.08, confidence: 0.08, sourceTrust: 0.08,
  historical: 0.04, preference: 0.03, contradiction: 0.12, stale: 0.08,
} as const;

const clamp = (value: number) => Math.max(0, Math.min(1, value));
const words = (value: string) => new Set(value.toLowerCase().match(/[a-z0-9]{2,}/g) ?? []);
export function keywordScore(query: string, text: string) {
  const queryWords = words(query);
  if (!queryWords.size) return 0;
  const textWords = words(text);
  return [...queryWords].filter((word) => textWords.has(word)).length / queryWords.size;
}

export interface RetrievalFactors {
  semantic: number; keyword: number; graph: number; scope: number; recency: number;
  importance: number; confidence: number; sourceTrust: number; historical: number;
  preference: number; contradictionPenalty: number; stalenessPenalty: number;
}
export function hybridScore(f: RetrievalFactors) {
  return clamp(
    f.semantic * weights.semantic + f.keyword * weights.keyword + f.graph * weights.graph +
    f.scope * weights.scope + f.recency * weights.recency + f.importance * weights.importance +
    f.confidence * weights.confidence + f.sourceTrust * weights.sourceTrust +
    f.historical * weights.historical + f.preference * weights.preference -
    f.contradictionPenalty * weights.contradiction - f.stalenessPenalty * weights.stale,
  );
}

export interface AdaptiveRetrievalRequest {
  query: string; userId: string; agentId?: string; organizationId?: string;
  workspaceId?: string; projectId?: string; runId?: string; requestId?: string;
  maxTokens?: number; maxItems?: number; anchorObjectIds?: string[];
  semanticScores?: Record<string, number>;
}

function numberMeta(metadata: unknown, key: string, fallback: number) {
  const value = (metadata as Record<string, unknown> | null)?.[key];
  return typeof value === "number" ? clamp(value) : fallback;
}

export async function retrieveAdaptiveContext(request: AdaptiveRetrievalRequest) {
  const started = Date.now();
  const requestId = request.requestId ?? randomUUID();
  const maxTokens = Math.max(128, Math.min(8000, request.maxTokens ?? 1600));
  await requireAdaptiveScope({ actorUserId: request.userId, organizationId: request.organizationId,
    workspaceId: request.workspaceId, projectId: request.projectId, permission: "knowledge.read" });
  const trace = await db.retrievalTrace.create({ data: {
    requestId, runId: request.runId, query: request.query, userId: request.userId,
    agentId: request.agentId, organizationId: request.organizationId,
    workspaceId: request.workspaceId, projectId: request.projectId,
    maxTokens, scoringVersion: RETRIEVAL_SCORING_VERSION,
  }});
  await emitAdaptiveEvent({ type: "retrieval.started", requestId, runId: request.runId,
    userId: request.userId, agentId: request.agentId, organizationId: request.organizationId,
    workspaceId: request.workspaceId, projectId: request.projectId, payload: { traceId: trace.id } });

  try {
    const queryTerms = [...words(request.query)].slice(0, 12);
    const anchorEdges = request.anchorObjectIds?.length ? await db.knowledgeEdge.findMany({
      where: { validTo: null, OR: [
        { fromObjectId: { in: request.anchorObjectIds } },
        { toObjectId: { in: request.anchorObjectIds } },
      ] }, select: { fromObjectId: true, toObjectId: true }, take: 200,
    }) : [];
    const graphNeighborIds = new Set(anchorEdges.flatMap((edge) => [edge.fromObjectId, edge.toObjectId]));
    const scopeBranches: Prisma.KnowledgeObjectWhereInput[] = [
      { scope: "user", userId: request.userId },
      ...(request.agentId ? [{ scope: "agent", metadata: { path: ["agentId"], equals: request.agentId } } as Prisma.KnowledgeObjectWhereInput] : []),
      ...(request.projectId ? [{ scope: "project", projectId: request.projectId }] : []),
      ...(request.workspaceId ? [{ scope: "workspace", workspaceId: request.workspaceId }] : []),
      ...(request.organizationId ? [{ scope: "organization", organizationId: request.organizationId }] : []),
    ];
    const objects = await db.knowledgeObject.findMany({ where: {
      validTo: null,
      AND: [
        { OR: scopeBranches },
        { OR: [
          { title: { contains: request.query, mode: "insensitive" } },
          { summary: { contains: request.query, mode: "insensitive" } },
          ...queryTerms.flatMap((term) => [
            { title: { contains: term, mode: "insensitive" as const } },
            { summary: { contains: term, mode: "insensitive" as const } },
          ]),
          ...(graphNeighborIds.size ? [{ id: { in: [...graphNeighborIds] } }] : []),
          // Semantic providers may nominate ids even when lexical overlap is zero.
          ...(request.semanticScores ? [{ id: { in: Object.keys(request.semanticScores) } }] : []),
        ] },
      ],
    }, orderBy: { updatedAt: "desc" }, take: 250 });

    const ids = objects.map((object) => object.id);
    const [contradictions, weightsByAgent] = await Promise.all([
      ids.length ? db.knowledgeEdge.findMany({ where: { validTo: null, type: "contradicts", OR: [{ fromObjectId: { in: ids } }, { toObjectId: { in: ids } }] }, select: { fromObjectId: true, toObjectId: true } }) : [],
      request.agentId && ids.length ? db.agentKnowledgeWeight.findMany({ where: { agentId: request.agentId, knowledgeObjectId: { in: ids } } }) : [],
    ]);
    const contradicted = new Set(contradictions.flatMap((edge) => [edge.fromObjectId, edge.toObjectId]));
    const agentWeights = new Map(weightsByAgent.map((weight) => [weight.knowledgeObjectId, weight]));
    const now = Date.now();
    const scored = objects.map((object) => {
      const text = `${object.title} ${object.summary ?? ""}`;
      const ageDays = Math.max(0, (now - object.updatedAt.getTime()) / 86_400_000);
      const exactScope = object.projectId === request.projectId ? 1 : object.workspaceId === request.workspaceId ? 0.85 : object.organizationId === request.organizationId ? 0.7 : 0.65;
      const agentWeight = agentWeights.get(object.id);
      const factors: RetrievalFactors = {
        semantic: clamp(request.semanticScores?.[object.id] ?? 0), keyword: keywordScore(request.query, text),
        graph: request.anchorObjectIds?.includes(object.id) ? 1 : graphNeighborIds.has(object.id) ? 0.65 : 0, scope: exactScope,
        recency: Math.exp(-ageDays / 90), importance: numberMeta(object.metadata, "importance", 0.5),
        confidence: numberMeta(object.metadata, "confidence", 0.5),
        sourceTrust: numberMeta(object.metadata, "sourceTrust", 0.5),
        historical: agentWeight ? clamp((agentWeight.successWeight + 1 - agentWeight.failureWeight) / 2) : 0.5,
        preference: agentWeight?.relevanceWeight ?? 0.5,
        contradictionPenalty: contradicted.has(object.id) ? 1 : 0,
        stalenessPenalty: ageDays > 365 ? Math.min(1, (ageDays - 365) / 365) : 0,
      };
      return { object, text, tokenCost: estimateTokens(text), factors, score: hybridScore(factors) };
    }).sort((a, b) => b.score - a.score);

    let usedTokens = 0;
    const limit = Math.min(100, Math.max(1, request.maxItems ?? 30));
    const rows = scored.map((item, index) => {
      const selected = index < limit && usedTokens + item.tokenCost <= maxTokens;
      if (selected) usedTokens += item.tokenCost;
      const reason = selected ? `Selected at rank ${index + 1} within token budget.` : index >= limit ? "Excluded by item limit." : "Excluded by token budget.";
      return { ...item, rank: index + 1, selected, reason };
    });
    await db.retrievalTraceItem.createMany({ data: rows.map(({ object, factors, score, rank, selected, reason, tokenCost }) => ({
      traceId: trace.id, knowledgeObjectId: object.id, sourceType: object.sourceType, sourceId: object.sourceId,
      title: object.title, semanticScore: factors.semantic, keywordScore: factors.keyword,
      graphScore: factors.graph, scopeScore: factors.scope, recencyScore: factors.recency,
      importanceScore: factors.importance, confidenceScore: factors.confidence,
      sourceTrustScore: factors.sourceTrust, historicalScore: factors.historical,
      preferenceScore: factors.preference, contradictionPenalty: factors.contradictionPenalty,
      stalenessPenalty: factors.stalenessPenalty, finalScore: score, rank, tokenCost,
      selected, appearedInPrompt: selected, reason,
    })) });
    await db.retrievalTrace.update({ where: { id: trace.id }, data: {
      status: "completed", selectedTokens: usedTokens, durationMs: Date.now() - started, completedAt: new Date(),
    }});
    for (const row of rows) await emitAdaptiveEvent({ type: row.selected ? "retrieval.item_selected" : "retrieval.item_rejected",
      requestId, runId: request.runId, userId: request.userId, agentId: request.agentId,
      workspaceId: request.workspaceId, projectId: request.projectId,
      payload: { traceId: trace.id, knowledgeObjectId: row.object.id, rank: row.rank, score: row.score, reason: row.reason },
    });
    await emitAdaptiveEvent({ type: "retrieval.completed", requestId, runId: request.runId,
      userId: request.userId, agentId: request.agentId, workspaceId: request.workspaceId,
      projectId: request.projectId, durationMs: Date.now() - started, tokenUsage: usedTokens,
      result: "completed", payload: { traceId: trace.id, selected: rows.filter((row) => row.selected).length } });
    return { traceId: trace.id, scoringVersion: RETRIEVAL_SCORING_VERSION, tokenUsage: usedTokens,
      items: rows.filter((row) => row.selected).map((row) => ({ id: row.object.id, title: row.object.title, summary: row.object.summary, score: row.score, tokenCost: row.tokenCost })) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await db.retrievalTrace.update({ where: { id: trace.id }, data: { status: "failed", error: message, durationMs: Date.now() - started, completedAt: new Date() } });
    throw error;
  }
}

export function getRetrievalTrace(id: string) {
  return db.retrievalTrace.findUnique({ where: { id }, include: { items: { orderBy: { rank: "asc" } } } });
}
