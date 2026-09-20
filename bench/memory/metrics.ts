// Sentinel memory benchmark — metric computation.
//
// Deliberately boring and explicit. Every metric is computed from the ordered
// retrieved id list and the case's declared relevant/forbidden sets, so a
// result can always be re-derived by hand from the stored JSON.

import type { AggregateMetrics, BenchCase, CaseResult } from "./types";

export const DEFAULT_K_VALUES = [1, 3, 5, 10, 20];

/** Recall@K: of the relevant memories, how many appear in the top K.
 *  A case with no relevant memories (pure rejection cases) has no recall —
 *  it returns NaN and is excluded from aggregation rather than scored 1.0,
 *  which would flatter the average. */
export function recallAtK(retrieved: string[], relevant: string[], k: number): number {
  if (relevant.length === 0) return Number.NaN;
  const top = new Set(retrieved.slice(0, k));
  const hits = relevant.filter((id) => top.has(id)).length;
  return hits / relevant.length;
}

/** Precision@K measured against the actual number of results returned, not K.
 *  Dividing by K would punish a case that legitimately has only two relevant
 *  memories and correctly returned exactly those two. */
export function precisionAtK(retrieved: string[], relevant: string[], k: number): number {
  const top = retrieved.slice(0, k);
  if (top.length === 0) return relevant.length === 0 ? 1 : 0;
  const relevantSet = new Set(relevant);
  const hits = top.filter((id) => relevantSet.has(id)).length;
  return hits / top.length;
}

/** Reciprocal rank of the first relevant memory. 0 when none was retrieved. */
export function reciprocalRank(retrieved: string[], relevant: string[]): number {
  if (relevant.length === 0) return Number.NaN;
  const relevantSet = new Set(relevant);
  const at = retrieved.findIndex((id) => relevantSet.has(id));
  return at === -1 ? 0 : 1 / (at + 1);
}

/** Pairwise order check over only the ids the case names. Ids missing from the
 *  retrieved list make the case unorderable (null), which is reported
 *  separately from "ordered wrongly" — failing to retrieve is a recall
 *  problem, not a temporal one. */
export function orderIsCorrect(retrieved: string[], expectedOrder: string[]): boolean | null {
  const positions = expectedOrder.map((id) => retrieved.indexOf(id));
  if (positions.some((p) => p === -1)) return null;
  for (let i = 1; i < positions.length; i += 1) {
    if (positions[i] <= positions[i - 1]) return false;
  }
  return true;
}

function mean(values: number[]): number {
  const usable = values.filter((v) => Number.isFinite(v));
  if (usable.length === 0) return Number.NaN;
  return usable.reduce((a, b) => a + b, 0) / usable.length;
}

function percentile(values: number[], p: number): number {
  const usable = values.filter((v) => Number.isFinite(v)).sort((a, b) => a - b);
  if (usable.length === 0) return Number.NaN;
  const index = Math.min(usable.length - 1, Math.ceil((p / 100) * usable.length) - 1);
  return usable[Math.max(0, index)];
}

export function scoreCase(
  testCase: BenchCase,
  retrieved: string[],
  injected: string[],
  timings: { retrievalMs: number; embeddingMs: number; rerankMs: number; contextTokens: number },
  kValues: number[] = DEFAULT_K_VALUES,
): CaseResult {
  const relevantSet = new Set(testCase.relevant);
  const forbidden = testCase.forbidden ?? [];
  const forbiddenSet = new Set(forbidden);
  const forbiddenRetrieved = retrieved.filter((id) => forbiddenSet.has(id));
  const irrelevant = retrieved.filter((id) => !relevantSet.has(id) && !forbiddenSet.has(id));

  const recall: Record<string, number> = {};
  const precision: Record<string, number> = {};
  for (const k of kValues) {
    recall[`@${k}`] = recallAtK(retrieved, testCase.relevant, k);
    precision[`@${k}`] = precisionAtK(retrieved, testCase.relevant, k);
  }

  return {
    caseId: testCase.id,
    categories: testCase.categories,
    retrievedIds: retrieved,
    injectedIds: injected,
    recallAtK: recall,
    precisionAtK: precision,
    reciprocalRank: reciprocalRank(retrieved, testCase.relevant),
    forbiddenRetrieved,
    forbiddenReason: forbiddenRetrieved.length > 0 ? (testCase.forbiddenReason ?? null) : null,
    irrelevantRetrieved: irrelevant.length,
    irrelevantRate: retrieved.length === 0 ? 0 : irrelevant.length / retrieved.length,
    orderCorrect: testCase.expectedOrder ? orderIsCorrect(retrieved, testCase.expectedOrder) : null,
    contextTokens: timings.contextTokens,
    retrievalLatencyMs: timings.retrievalMs,
    embeddingLatencyMs: timings.embeddingMs,
    rerankLatencyMs: timings.rerankMs,
  };
}

const LEAKAGE_REASONS = new Set(["leakage"]);

export function aggregate(results: CaseResult[], kValues: number[] = DEFAULT_K_VALUES): AggregateMetrics {
  const recall: Record<string, number> = {};
  const precision: Record<string, number> = {};
  for (const k of kValues) {
    recall[`@${k}`] = mean(results.map((r) => r.recallAtK[`@${k}`]));
    precision[`@${k}`] = mean(results.map((r) => r.precisionAtK[`@${k}`]));
  }

  const orderable = results.filter((r) => r.orderCorrect !== null);
  const latencies = results.map((r) => r.retrievalLatencyMs);

  return {
    cases: results.length,
    recallAtK: recall,
    precisionAtK: precision,
    mrr: mean(results.map((r) => r.reciprocalRank)),
    falseRetrievalRate:
      results.length === 0 ? 0 : results.filter((r) => r.forbiddenRetrieved.length > 0).length / results.length,
    scopeLeakageRate:
      results.length === 0
        ? 0
        : results.filter((r) => r.forbiddenRetrieved.length > 0 && LEAKAGE_REASONS.has(r.forbiddenReason ?? ""))
            .length / results.length,
    irrelevantRetrievalRate: mean(results.map((r) => r.irrelevantRate)),
    temporalAccuracy: orderable.length === 0 ? null : orderable.filter((r) => r.orderCorrect).length / orderable.length,
    meanContextTokens: mean(results.map((r) => r.contextTokens)),
    meanRetrievalLatencyMs: mean(latencies),
    p95RetrievalLatencyMs: percentile(latencies, 95),
    meanEmbeddingLatencyMs: mean(results.map((r) => r.embeddingLatencyMs)),
    meanRerankLatencyMs: mean(results.map((r) => r.rerankLatencyMs)),
    errors: results.filter((r) => r.error).length,
  };
}

export function aggregateByCategory(
  results: CaseResult[],
  kValues: number[] = DEFAULT_K_VALUES,
): Record<string, AggregateMetrics> {
  const buckets = new Map<string, CaseResult[]>();
  for (const result of results) {
    for (const category of result.categories) {
      const list = buckets.get(category) ?? [];
      list.push(result);
      buckets.set(category, list);
    }
  }
  const out: Record<string, AggregateMetrics> = {};
  for (const [category, list] of [...buckets.entries()].sort()) {
    out[category] = aggregate(list, kValues);
  }
  return out;
}
