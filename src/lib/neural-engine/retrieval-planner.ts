// Sentinel Neural Engine — Retrieval Planner (Layer 6, Phase C)
//
// Real multi-factor ranking over KnowledgeObject rows: scope, recency,
// confidence, importance, provenance quality, prior success/failure (this
// agent's AgentKnowledgeWeight), agent competency, task type, explicit user
// selection, a lexical relevance proxy, and bounded graph proximity.
//
// Honesty note on "semantic_similarity": there is no embedding index in this
// repo today (see docs/neural-engine/PHASE_A_CONFLICTS.md — pgvector support
// was regressed before this project started). The `semantic_similarity`
// factor is computed as token-overlap (Jaccard) between the query and each
// candidate's title/summary. That is a real, working relevance signal, but it
// is lexical, not semantic — restoring pgvector and swapping this factor for
// real embedding cosine similarity is the natural first upgrade once that
// infrastructure exists. Nothing here pretends otherwise.

import { db } from "@/lib/db";
import { coarseDomain } from "./evaluation-service";
import type { RetrievalContext } from "@/lib/knowledge/types";

export interface RetrievalRequest extends RetrievalContext {
  query: string;
  taskType?: string;
  agentId?: string;
  explicitObjectIds?: string[];
}

export type RetrievalFactorName =
  | "semantic_similarity"
  | "graph_proximity"
  | "scope"
  | "recency"
  | "confidence"
  | "importance"
  | "provenance_quality"
  | "prior_success"
  | "prior_failure"
  | "agent_competency"
  | "task_type"
  | "explicit_selection";

export interface RetrievalRankingFactor {
  factor: RetrievalFactorName;
  weight: number;
  score: number;
}

export interface RetrievalResultItem {
  objectId: string;
  finalScore: number;
  factors: RetrievalRankingFactor[];
}

/** Provenance trace only — never chain-of-thought. */
export interface RetrievalTrace {
  requestId: string;
  scope: string;
  sourceObjectIds: string[];
  relationshipPaths: Array<{ from: string; to: string; via: string[] }>;
  rankingFactors: RetrievalRankingFactor[];
  confidence: number;
}

export interface RetrievalPlan {
  request: RetrievalRequest;
  candidateObjectIds: string[];
}

export interface RetrievalResult {
  items: RetrievalResultItem[];
  trace: RetrievalTrace;
}

const SCOPE_ORDER = [
  "session",
  "project",
  "workspace",
  "organization",
  "user",
  "global",
] as const;
type Scope = (typeof SCOPE_ORDER)[number];

/** Mirrors src/lib/knowledge/retrieval.ts's allowedScopes — kept in sync deliberately. */
function allowedScopes(ctx: RetrievalContext): Scope[] {
  if (ctx.projectId) return ["session", "project", "workspace", "organization", "user", "global"];
  if (ctx.workspaceId) return ["session", "workspace", "organization", "user", "global"];
  if (ctx.organizationId) return ["session", "organization", "user", "global"];
  return ["session", "user", "global"];
}

const MAX_CANDIDATES = 200;
const DEFAULT_RESULT_LIMIT = 20;
const GRAPH_PROXIMITY_MAX_DEPTH = 2;
const RECENCY_HALF_LIFE_DAYS = 14;

/** Coarse task-type -> object-type affinity. Extend as real task taxonomy grows. */
const TASK_TYPE_AFFINITY: Record<string, string[]> = {
  coding: ["Artifact", "Repository", "File", "Module"],
  planning: ["Decision", "Task", "Workflow"],
  research: ["Note", "Memory"],
  support: ["Memory", "Note", "Conversation"],
};

export const FACTOR_WEIGHTS: Record<RetrievalFactorName, number> = {
  explicit_selection: 3.0,
  semantic_similarity: 1.5,
  scope: 1.0,
  prior_success: 1.0,
  prior_failure: 1.0,
  recency: 0.7,
  confidence: 0.6,
  importance: 0.6,
  agent_competency: 0.6,
  task_type: 0.5,
  provenance_quality: 0.5,
  graph_proximity: 0.8,
};

/**
 * Build the candidate set: every KnowledgeObject in the caller's allowed
 * scope (project isolation enforced identically to
 * src/lib/knowledge/retrieval.ts), plus any explicitly requested ids.
 */
export async function planRetrieval(request: RetrievalRequest): Promise<RetrievalPlan> {
  const scopes = allowedScopes(request);

  const scoped = await db.knowledgeObject.findMany({
    where: {
      validTo: null,
      scope: { in: scopes },
      OR: [
        { scope: { not: "project" } },
        request.projectId
          ? { scope: "project", projectId: request.projectId }
          : { scope: "project", projectId: null },
      ],
    },
    select: { id: true },
    orderBy: { updatedAt: "desc" },
    take: MAX_CANDIDATES,
  });

  const candidateIds = new Set(scoped.map((o) => o.id));
  for (const id of request.explicitObjectIds ?? []) candidateIds.add(id);

  return { request, candidateObjectIds: [...candidateIds] };
}

interface CandidateSignals {
  id: string;
  type: string;
  scope: string;
  title: string;
  summary: string;
  updatedAt: Date;
  confidence: number | null;
  importance: number | null;
  provenanceQuality: number;
}

/** Batch-enrich candidates with signals that live on the source tables, not on KnowledgeObject. */
async function loadCandidateSignals(objectIds: string[]): Promise<Map<string, CandidateSignals>> {
  const objects = await db.knowledgeObject.findMany({
    where: { id: { in: objectIds } },
  });

  const memorySourceIds = objects.filter((o) => o.sourceType === "memory").map((o) => o.sourceId);
  const decisionSourceIds = objects
    .filter((o) => o.sourceType === "decision")
    .map((o) => o.sourceId);

  const [memories, decisions] = await Promise.all([
    memorySourceIds.length
      ? db.memory.findMany({
          where: { id: { in: memorySourceIds } },
          select: { id: true, confidence: true, importanceScore: true, source: true },
        })
      : Promise.resolve([]),
    decisionSourceIds.length
      ? db.decision.findMany({
          where: { id: { in: decisionSourceIds } },
          select: { id: true, status: true },
        })
      : Promise.resolve([]),
  ]);

  const memoryById = new Map(memories.map((m) => [m.id, m]));
  const decisionById = new Map(decisions.map((d) => [d.id, d]));

  const signals = new Map<string, CandidateSignals>();
  for (const o of objects) {
    let confidence: number | null = null;
    let importance: number | null = null;
    // Provenance quality: user-authored/approved content ranks above
    // system-generated inferences. Heuristic, documented — there is no
    // dedicated provenance-quality field on any source table yet.
    let provenanceQuality = 0.5;

    if (o.sourceType === "memory") {
      const m = memoryById.get(o.sourceId);
      if (m) {
        confidence = m.confidence;
        importance = m.importanceScore;
        provenanceQuality = m.source.startsWith("neural-engine:") ? 0.55 : 0.7;
      }
    } else if (o.sourceType === "decision") {
      const d = decisionById.get(o.sourceId);
      provenanceQuality = d?.status === "approved" ? 0.9 : 0.75;
    } else if (o.sourceType === "obsidian_note") {
      provenanceQuality = 0.8;
    }

    signals.set(o.id, {
      id: o.id,
      type: o.type,
      scope: o.scope,
      title: o.title,
      summary: o.summary ?? "",
      updatedAt: o.updatedAt,
      confidence,
      importance,
      provenanceQuality,
    });
  }
  return signals;
}

function tokenize(text: string): Set<string> {
  return new Set(
    text
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((t) => t.length > 2),
  );
}

/** Lexical relevance proxy — see the file-header honesty note. */
export function lexicalOverlapScore(query: string, candidateText: string): number {
  const q = tokenize(query);
  const c = tokenize(candidateText);
  if (q.size === 0 || c.size === 0) return 0;
  let intersection = 0;
  for (const t of q) if (c.has(t)) intersection++;
  const union = new Set([...q, ...c]).size;
  return union === 0 ? 0 : intersection / union;
}

function recencyScore(updatedAt: Date): number {
  const ageDays = (Date.now() - updatedAt.getTime()) / (1000 * 60 * 60 * 24);
  return Math.pow(0.5, Math.max(0, ageDays) / RECENCY_HALF_LIFE_DAYS);
}

function scopeScore(scope: string): number {
  const idx = SCOPE_ORDER.indexOf(scope as Scope);
  if (idx < 0) return 0.3;
  return 1 - idx / (SCOPE_ORDER.length - 1);
}

/** BFS over KnowledgeEdge, bounded depth, from a set of seed ids. Returns hop-count map + paths taken. */
async function computeGraphProximity(
  seedIds: string[],
  candidateIds: Set<string>,
): Promise<{ hops: Map<string, number>; paths: Array<{ from: string; to: string; via: string[] }> }> {
  const hops = new Map<string, number>();
  const paths: Array<{ from: string; to: string; via: string[] }> = [];
  if (seedIds.length === 0) return { hops, paths };

  for (const seed of seedIds) hops.set(seed, 0);
  let frontier = [...seedIds];

  for (let depth = 1; depth <= GRAPH_PROXIMITY_MAX_DEPTH && frontier.length > 0; depth++) {
    const edges = await db.knowledgeEdge.findMany({
      where: {
        validTo: null,
        OR: [{ fromObjectId: { in: frontier } }, { toObjectId: { in: frontier } }],
      },
      select: { fromObjectId: true, toObjectId: true },
      take: 500,
    });

    const nextFrontier: string[] = [];
    for (const e of edges) {
      const [known, other] =
        frontier.includes(e.fromObjectId) ? [e.fromObjectId, e.toObjectId] : [e.toObjectId, e.fromObjectId];
      if (!hops.has(other)) {
        hops.set(other, depth);
        nextFrontier.push(other);
        if (candidateIds.has(other)) {
          paths.push({ from: known, to: other, via: [known] });
        }
      }
    }
    frontier = nextFrontier;
  }

  return { hops, paths };
}

/**
 * Score one candidate against pure, already-resolved inputs — no DB access,
 * so this is directly unit-testable per factor.
 */
export function scoreCandidateFactors(
  signals: CandidateSignals,
  request: RetrievalRequest,
  extras: {
    isExplicit: boolean;
    graphHops: number | null;
    successWeight: number;
    failureWeight: number;
    competencyScore: number | null;
  },
): RetrievalRankingFactor[] {
  const taskAffinity = request.taskType ? TASK_TYPE_AFFINITY[request.taskType] : undefined;

  const factors: RetrievalRankingFactor[] = [
    {
      factor: "explicit_selection",
      weight: FACTOR_WEIGHTS.explicit_selection,
      score: extras.isExplicit ? 1 : 0,
    },
    {
      factor: "semantic_similarity",
      weight: FACTOR_WEIGHTS.semantic_similarity,
      score: lexicalOverlapScore(request.query, `${signals.title} ${signals.summary}`),
    },
    { factor: "scope", weight: FACTOR_WEIGHTS.scope, score: scopeScore(signals.scope) },
    {
      factor: "recency",
      weight: FACTOR_WEIGHTS.recency,
      score: recencyScore(signals.updatedAt),
    },
    {
      factor: "confidence",
      weight: FACTOR_WEIGHTS.confidence,
      score: signals.confidence ?? 0.5,
    },
    {
      factor: "importance",
      weight: FACTOR_WEIGHTS.importance,
      score: signals.importance ?? 0.5,
    },
    {
      factor: "provenance_quality",
      weight: FACTOR_WEIGHTS.provenance_quality,
      score: signals.provenanceQuality,
    },
    {
      factor: "prior_success",
      weight: FACTOR_WEIGHTS.prior_success,
      score: extras.successWeight,
    },
    {
      factor: "prior_failure",
      // Penalty: subtract its contribution rather than add — encoded via a
      // negative weight so higher failureWeight lowers finalScore.
      weight: -FACTOR_WEIGHTS.prior_failure,
      score: extras.failureWeight,
    },
    {
      factor: "agent_competency",
      weight: FACTOR_WEIGHTS.agent_competency,
      score: extras.competencyScore ?? 0.5,
    },
    {
      factor: "task_type",
      weight: FACTOR_WEIGHTS.task_type,
      score: taskAffinity ? (taskAffinity.includes(signals.type) ? 1 : 0.2) : 0.5,
    },
    {
      factor: "graph_proximity",
      weight: FACTOR_WEIGHTS.graph_proximity,
      score: extras.graphHops == null ? 0 : 1 / (1 + extras.graphHops),
    },
  ];

  return factors;
}

function finalScoreOf(factors: RetrievalRankingFactor[]): number {
  return factors.reduce((sum, f) => sum + f.weight * f.score, 0);
}

/**
 * Execute a plan: enrich candidates, score every factor, rank, and produce a
 * provenance trace (ranking factors + relationship paths + source ids — never
 * chain-of-thought).
 */
export async function executeRetrievalPlan(plan: RetrievalPlan): Promise<RetrievalResult> {
  const { request, candidateObjectIds } = plan;
  const requestId = `ret-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;

  if (candidateObjectIds.length === 0) {
    return {
      items: [],
      trace: {
        requestId,
        scope: allowedScopes(request)[0],
        sourceObjectIds: [],
        relationshipPaths: [],
        rankingFactors: [],
        confidence: 0,
      },
    };
  }

  const signalsById = await loadCandidateSignals(candidateObjectIds);
  const explicitSet = new Set(request.explicitObjectIds ?? []);

  const seedIds = explicitSet.size > 0 ? [...explicitSet] : candidateObjectIds.slice(0, 5);
  const { hops, paths } = await computeGraphProximity(seedIds, new Set(candidateObjectIds));

  let weights: Map<string, { successWeight: number; failureWeight: number }> = new Map();
  let competencyScore: number | null = null;
  if (request.agentId) {
    const [agentWeights, competency] = await Promise.all([
      db.agentKnowledgeWeight.findMany({
        where: { agentId: request.agentId, knowledgeObjectId: { in: candidateObjectIds } },
        select: { knowledgeObjectId: true, successWeight: true, failureWeight: true },
      }),
      db.agentCompetency.findUnique({
        where: {
          agentId_domain: { agentId: request.agentId, domain: coarseDomain(request.query) },
        },
        select: { score: true },
      }),
    ]);
    weights = new Map(agentWeights.map((w) => [w.knowledgeObjectId, w]));
    competencyScore = competency?.score ?? null;
  }

  const items: RetrievalResultItem[] = [];
  for (const objectId of candidateObjectIds) {
    const signals = signalsById.get(objectId);
    if (!signals) continue; // object was superseded/deleted between plan and execute

    const w = weights.get(objectId);
    const factors = scoreCandidateFactors(signals, request, {
      isExplicit: explicitSet.has(objectId),
      graphHops: hops.get(objectId) ?? null,
      successWeight: w?.successWeight ?? 0,
      failureWeight: w?.failureWeight ?? 0,
      competencyScore,
    });

    items.push({ objectId, finalScore: finalScoreOf(factors), factors });
  }

  items.sort((a, b) => b.finalScore - a.finalScore);
  const limit = request.maxItems ?? DEFAULT_RESULT_LIMIT;
  const top = items.slice(0, limit);

  // Aggregate per-factor average score across the returned set, for the trace.
  const factorTotals = new Map<RetrievalFactorName, { sum: number; count: number; weight: number }>();
  for (const item of top) {
    for (const f of item.factors) {
      const entry = factorTotals.get(f.factor) ?? { sum: 0, count: 0, weight: f.weight };
      entry.sum += f.score;
      entry.count += 1;
      factorTotals.set(f.factor, entry);
    }
  }
  const rankingFactors: RetrievalRankingFactor[] = [...factorTotals.entries()].map(
    ([factor, { sum, count, weight }]) => ({ factor, weight, score: count ? sum / count : 0 }),
  );

  // Confidence in the overall retrieval: how much real (non-default) signal
  // fed it — explicit query, agent context, and non-empty results.
  let confidence = 0.3;
  if (request.query.trim().length > 0) confidence += 0.2;
  if (request.agentId) confidence += 0.2;
  if (top.length > 0) confidence += 0.3;
  confidence = Math.min(1, confidence);

  return {
    items: top,
    trace: {
      requestId,
      scope: allowedScopes(request)[0],
      sourceObjectIds: top.map((i) => i.objectId),
      relationshipPaths: paths,
      rankingFactors,
      confidence,
    },
  };
}

/** Convenience: plan + execute in one call. */
export async function retrieve(request: RetrievalRequest): Promise<RetrievalResult> {
  const plan = await planRetrieval(request);
  return executeRetrievalPlan(plan);
}
