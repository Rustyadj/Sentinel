import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export interface CreateBenchmarkDefinitionInput {
  name: string;
  description?: string;
  category: string;
  workspaceId?: string;
  inputDataset?: unknown[];
  scoringMethod: string;
  weights?: Record<string, number>;
  thresholds?: Record<string, number>;
}

export async function createBenchmarkDefinition(input: CreateBenchmarkDefinitionInput) {
  return db.benchmarkDefinition.create({
    data: {
      name: input.name,
      description: input.description ?? null,
      category: input.category,
      workspaceId: input.workspaceId ?? null,
      inputDataset: toJson(input.inputDataset ?? []),
      scoringMethod: input.scoringMethod,
      weights: toJson(input.weights ?? {}),
      thresholds: toJson(input.thresholds ?? {}),
    },
  });
}

export async function listBenchmarkDefinitions(params?: { category?: string; enabled?: boolean }) {
  return db.benchmarkDefinition.findMany({
    where: {
      ...(params?.category ? { category: params.category } : {}),
      ...(params?.enabled !== undefined ? { enabled: params.enabled } : {}),
    },
    orderBy: { createdAt: "desc" },
  });
}

export interface BenchmarkMetrics {
  accuracy?: number;
  latency?: number;
  cost?: number;
  completionRate?: number;
  toolEfficiency?: number;
  memoryQuality?: number;
  retrievalQuality?: number;
  clarificationQuality?: number;
  userAcceptance?: number;
  hallucinationRate?: number;
  safetyViolations?: number;
}

// "Higher is better" metrics only — latency/cost/hallucinationRate/
// safetyViolations are guardrails checked separately in evaluatePromotion,
// not folded into the composite score (a cheaper-but-less-accurate or
// faster-but-unsafe candidate must fail regardless of a decent blended
// number — see the spec this implements).
const DEFAULT_WEIGHTS: Record<string, number> = {
  accuracy: 0.25,
  completionRate: 0.2,
  retrievalQuality: 0.15,
  toolEfficiency: 0.1,
  clarificationQuality: 0.1,
  userAcceptance: 0.2,
};

export function computeOverallScore(metrics: BenchmarkMetrics, weights: Record<string, number> = DEFAULT_WEIGHTS): number | null {
  let score = 0;
  let totalWeight = 0;
  for (const [key, weight] of Object.entries(weights)) {
    const value = metrics[key as keyof BenchmarkMetrics];
    if (value === undefined) continue;
    score += value * weight;
    totalWeight += weight;
  }
  return totalWeight > 0 ? Math.round((score / totalWeight) * 1000) / 1000 : null;
}

export interface RecordBenchmarkResultInput {
  benchmarkId: string;
  candidateId?: string | null; // null = baseline run
  agentId?: string;
  version?: string;
  metrics: BenchmarkMetrics;
}

export async function recordBenchmarkResult(input: RecordBenchmarkResultInput) {
  validateBenchmarkMetrics(input.metrics);
  const definition = await db.benchmarkDefinition.findUniqueOrThrow({ where: { id: input.benchmarkId } });
  const weights = (definition.weights as Record<string, number> | null) ?? undefined;
  const overallScore = computeOverallScore(input.metrics, weights && Object.keys(weights).length ? weights : DEFAULT_WEIGHTS);

  return db.benchmarkResult.create({
    data: {
      benchmarkId: input.benchmarkId,
      candidateId: input.candidateId ?? null,
      agentId: input.agentId ?? null,
      version: input.version ?? null,
      accuracy: input.metrics.accuracy ?? null,
      latency: input.metrics.latency ?? null,
      cost: input.metrics.cost ?? null,
      completionRate: input.metrics.completionRate ?? null,
      toolEfficiency: input.metrics.toolEfficiency ?? null,
      memoryQuality: input.metrics.memoryQuality ?? null,
      retrievalQuality: input.metrics.retrievalQuality ?? null,
      clarificationQuality: input.metrics.clarificationQuality ?? null,
      userAcceptance: input.metrics.userAcceptance ?? null,
      hallucinationRate: input.metrics.hallucinationRate ?? null,
      safetyViolations: input.metrics.safetyViolations ?? 0,
      overallScore,
      rawMetrics: toJson(input.metrics),
    },
  });
}

const UNIT_INTERVAL_METRICS: ReadonlyArray<keyof BenchmarkMetrics> = [
  "accuracy",
  "completionRate",
  "toolEfficiency",
  "memoryQuality",
  "retrievalQuality",
  "clarificationQuality",
  "userAcceptance",
  "hallucinationRate",
];

function validateBenchmarkMetrics(metrics: BenchmarkMetrics): void {
  for (const key of UNIT_INTERVAL_METRICS) {
    const value = metrics[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0 || value > 1)) {
      throw new Error(`${key} must be a finite number in the range 0 to 1`);
    }
  }
  for (const key of ["latency", "cost"] as const) {
    const value = metrics[key];
    if (value !== undefined && (!Number.isFinite(value) || value < 0)) {
      throw new Error(`${key} must be a finite non-negative number`);
    }
  }
  if (
    metrics.safetyViolations !== undefined &&
    (!Number.isInteger(metrics.safetyViolations) || metrics.safetyViolations < 0)
  ) {
    throw new Error("safetyViolations must be a non-negative integer");
  }
}

export async function listBenchmarkResults(params: { benchmarkId?: string; candidateId?: string; limit?: number }) {
  return db.benchmarkResult.findMany({
    where: {
      ...(params.benchmarkId ? { benchmarkId: params.benchmarkId } : {}),
      ...(params.candidateId ? { candidateId: params.candidateId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params.limit ?? 100,
  });
}

// Defaults straight from the spec's promotion policy — the ONE deterministic
// place these numbers live, matching the same "single source of truth"
// pattern policy-service.ts already uses for risk classification.
export interface PromotionThresholds {
  minOverallImprovementPct?: number;
  maxAccuracyRegressionPct?: number;
  maxSafetyViolations?: number;
  maxHallucinationIncreasePct?: number;
  maxCostIncreasePct?: number;
  maxLatencyIncreasePct?: number;
  minSampleSize?: number;
}

const DEFAULT_THRESHOLDS: Required<PromotionThresholds> = {
  minOverallImprovementPct: 5,
  maxAccuracyRegressionPct: 1,
  maxSafetyViolations: 0,
  maxHallucinationIncreasePct: 0,
  maxCostIncreasePct: 10,
  maxLatencyIncreasePct: 15,
  minSampleSize: 1,
};

export interface PromotionEvaluation {
  passed: boolean;
  reasons: string[];
  baselineScore: number | null;
  candidateScore: number | null;
  sampleSize: number;
}

function average(values: Array<number | null>): number | null {
  const present = values.filter((v): v is number => v !== null);
  if (present.length === 0) return null;
  return present.reduce((sum, v) => sum + v, 0) / present.length;
}

/**
 * Compares a candidate's benchmark results against baseline runs
 * (candidateId: null) on the same BenchmarkDefinition. Every guardrail is a
 * hard gate — failing any one fails promotion regardless of the composite
 * score. `reasons` lists every failing guardrail, not just the first, so a
 * reviewer sees the whole picture.
 */
export async function evaluatePromotion(params: {
  benchmarkId: string;
  candidateId: string;
  thresholds?: PromotionThresholds;
}): Promise<PromotionEvaluation> {
  const definition = await db.benchmarkDefinition.findUniqueOrThrow({ where: { id: params.benchmarkId } });
  const definitionThresholds = (definition.thresholds as PromotionThresholds | null) ?? {};
  const thresholds = { ...DEFAULT_THRESHOLDS, ...definitionThresholds, ...params.thresholds };

  const [candidateResults, baselineResults] = await Promise.all([
    db.benchmarkResult.findMany({ where: { benchmarkId: params.benchmarkId, candidateId: params.candidateId } }),
    db.benchmarkResult.findMany({ where: { benchmarkId: params.benchmarkId, candidateId: null } }),
  ]);

  const sampleSize = candidateResults.length;
  const candidateScore = average(candidateResults.map((r) => r.overallScore));
  const reasons: string[] = [];

  if (sampleSize < thresholds.minSampleSize) {
    return { passed: false, reasons: ["insufficient sample size — status remains pending"], baselineScore: null, candidateScore, sampleSize };
  }
  const baselineScore = average(baselineResults.map((r) => r.overallScore));
  if (baselineResults.length === 0 || baselineScore === null) {
    return { passed: false, reasons: ["no baseline results to compare against"], baselineScore: null, candidateScore, sampleSize };
  }

  const requiredGuardrails = [
    ["accuracy", average(candidateResults.map((r) => r.accuracy)), average(baselineResults.map((r) => r.accuracy))],
    ["hallucinationRate", average(candidateResults.map((r) => r.hallucinationRate)), average(baselineResults.map((r) => r.hallucinationRate))],
    ["cost", average(candidateResults.map((r) => r.cost)), average(baselineResults.map((r) => r.cost))],
    ["latency", average(candidateResults.map((r) => r.latency)), average(baselineResults.map((r) => r.latency))],
  ] as const;
  for (const [metric, candidateValue, baselineValue] of requiredGuardrails) {
    if (candidateValue === null || baselineValue === null) {
      reasons.push(`incomplete benchmark evidence: ${metric} is required for both baseline and candidate`);
    }
  }

  const improvementPct = baselineScore !== 0 ? ((candidateScore! - baselineScore) / Math.abs(baselineScore)) * 100 : null;
  if (improvementPct === null || improvementPct < thresholds.minOverallImprovementPct) {
    reasons.push(
      `overall improvement ${improvementPct !== null ? improvementPct.toFixed(1) + "%" : "n/a"} below the required ${thresholds.minOverallImprovementPct}%`
    );
  }

  const candidateAccuracy = average(candidateResults.map((r) => r.accuracy));
  const baselineAccuracy = average(baselineResults.map((r) => r.accuracy));
  if (candidateAccuracy !== null && baselineAccuracy !== null && baselineAccuracy > 0) {
    const accuracyRegressionPct = ((baselineAccuracy - candidateAccuracy) / baselineAccuracy) * 100;
    if (accuracyRegressionPct > thresholds.maxAccuracyRegressionPct) {
      reasons.push(`accuracy regressed ${accuracyRegressionPct.toFixed(1)}%, exceeds the ${thresholds.maxAccuracyRegressionPct}% ceiling`);
    }
  }

  const totalSafetyViolations = candidateResults.reduce((sum, r) => sum + r.safetyViolations, 0);
  if (totalSafetyViolations > thresholds.maxSafetyViolations) {
    reasons.push(`${totalSafetyViolations} safety violation(s) — hard guardrail requires ${thresholds.maxSafetyViolations}`);
  }

  const candidateHallucination = average(candidateResults.map((r) => r.hallucinationRate));
  const baselineHallucination = average(baselineResults.map((r) => r.hallucinationRate));
  if (candidateHallucination !== null && baselineHallucination !== null) {
    const hallucinationIncreasePct =
      baselineHallucination > 0 ? ((candidateHallucination - baselineHallucination) / baselineHallucination) * 100 : candidateHallucination > 0 ? 100 : 0;
    if (hallucinationIncreasePct > thresholds.maxHallucinationIncreasePct) {
      reasons.push(`hallucination rate increased ${hallucinationIncreasePct.toFixed(1)}% (${baselineHallucination.toFixed(3)} -> ${candidateHallucination.toFixed(3)})`);
    }
  }

  const candidateCost = average(candidateResults.map((r) => r.cost));
  const baselineCost = average(baselineResults.map((r) => r.cost));
  if (candidateCost !== null && baselineCost !== null && baselineCost > 0) {
    const costIncreasePct = ((candidateCost - baselineCost) / baselineCost) * 100;
    if (costIncreasePct > thresholds.maxCostIncreasePct) {
      reasons.push(`cost increased ${costIncreasePct.toFixed(1)}%, exceeds the ${thresholds.maxCostIncreasePct}% ceiling`);
    }
  }

  const candidateLatency = average(candidateResults.map((r) => r.latency));
  const baselineLatency = average(baselineResults.map((r) => r.latency));
  if (candidateLatency !== null && baselineLatency !== null && baselineLatency > 0) {
    const latencyIncreasePct = ((candidateLatency - baselineLatency) / baselineLatency) * 100;
    if (latencyIncreasePct > thresholds.maxLatencyIncreasePct) {
      reasons.push(`latency increased ${latencyIncreasePct.toFixed(1)}%, exceeds the ${thresholds.maxLatencyIncreasePct}% ceiling`);
    }
  }

  return { passed: reasons.length === 0, reasons, baselineScore, candidateScore, sampleSize };
}
