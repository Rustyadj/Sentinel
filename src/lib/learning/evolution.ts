// Evolution Archive — extends LearningCandidate (see its schema block)
// rather than forking a second candidate/experiment system. This module
// owns: lineage (parent -> descendants), multi-objective fitness, novelty
// scoring, and champion/challenger promotion. It never deletes a candidate —
// "archive" is a status, not a table you can fall out of.

import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { proposeCandidate } from "@/lib/neural-engine/learning-service";
import type { ProposedLearningCandidateInput } from "@/lib/neural-engine/types";
import { emitLearningEvent } from "./event-service";
import { syncCandidateNode, linkLearningEdge } from "./graph-sync";

// --- Multi-objective fitness --------------------------------------------

export interface FitnessVector {
  taskSuccess?: number;
  accuracy?: number;
  userCorrectionRate?: number;
  hallucinationRate?: number;
  toolSuccess?: number;
  clarificationQuality?: number;
  retrievalQuality?: number;
  latency?: number;
  tokenCost?: number;
  monetaryCost?: number;
  safety?: number;
  security?: number;
  userPreferenceAlignment?: number;
  generalization?: number;
  robustness?: number;
  novelty?: number;
}

export type FitnessDimension = keyof FitnessVector;

// Every dimension is expected on a 0..1 scale where the caller has already
// normalized "1 = good" — for cost/error dimensions that means the caller
// passes e.g. `1 - hallucinationRateObserved`, OR marks the dimension here as
// lower-is-better and passes the raw observed rate; this module treats the
// dimensions below as raw rates it inverts itself so callers can hand in the
// metric they actually measured.
const LOWER_IS_BETTER: ReadonlySet<FitnessDimension> = new Set([
  "userCorrectionRate",
  "hallucinationRate",
  "latency",
  "tokenCost",
  "monetaryCost",
]);

// Default policy weights. Deliberately NOT immutable architecture — a
// workspace-scoped LearningSettings row can override via
// `benchmarkThresholds.fitnessWeights` (reusing the existing Json config
// field rather than adding a second weights table); resolveFitnessWeights()
// below is the seam. Sums to 1.0.
export const DEFAULT_FITNESS_WEIGHTS: Record<FitnessDimension, number> = {
  taskSuccess: 0.16,
  accuracy: 0.12,
  userCorrectionRate: 0.1,
  hallucinationRate: 0.12,
  toolSuccess: 0.07,
  clarificationQuality: 0.07,
  retrievalQuality: 0.07,
  latency: 0.03,
  tokenCost: 0.03,
  monetaryCost: 0.03,
  safety: 0.08,
  security: 0.08,
  userPreferenceAlignment: 0.02,
  generalization: 0.01,
  robustness: 0.01,
  novelty: 0,
};

export async function resolveFitnessWeights(
  scope: { workspaceId?: string | null } = {},
): Promise<Record<FitnessDimension, number>> {
  if (!scope.workspaceId) return DEFAULT_FITNESS_WEIGHTS;
  const settings = await db.learningSettings.findUnique({
    where: { scopeType_scopeId: { scopeType: "workspace", scopeId: scope.workspaceId } },
    select: { benchmarkThresholds: true },
  });
  const configured = (settings?.benchmarkThresholds as { fitnessWeights?: Partial<Record<FitnessDimension, number>> } | null)
    ?.fitnessWeights;
  if (!configured) return DEFAULT_FITNESS_WEIGHTS;
  return { ...DEFAULT_FITNESS_WEIGHTS, ...configured };
}

export function computeFitnessScore(
  vector: FitnessVector,
  weights: Record<FitnessDimension, number> = DEFAULT_FITNESS_WEIGHTS,
): number {
  let weightedSum = 0;
  let totalWeight = 0;
  for (const key of Object.keys(DEFAULT_FITNESS_WEIGHTS) as FitnessDimension[]) {
    const raw = vector[key];
    if (raw === undefined || raw === null || Number.isNaN(raw)) continue;
    const weight = weights[key] ?? 0;
    if (weight <= 0) continue;
    const clamped = Math.min(Math.max(raw, 0), 1);
    const normalized = LOWER_IS_BETTER.has(key) ? 1 - clamped : clamped;
    weightedSum += normalized * weight;
    totalWeight += weight;
  }
  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 1000) / 1000;
}

// Hard guardrails: an aggregate fitness win never overrides these. Directly
// implements the spec's worked example — task success +4% but hallucination
// +3% must not automatically win. Every dimension here defaults to
// "no regression allowed at all" (0), not "no regression beyond the
// improvement" — see promoteChallenger for how this composes with fitness.
export interface FitnessGuardrails {
  maxHallucinationRateIncrease?: number;
  maxUserCorrectionRateIncrease?: number;
  maxSafetyRegression?: number;
  maxSecurityRegression?: number;
}

const DEFAULT_GUARDRAILS: Required<FitnessGuardrails> = {
  maxHallucinationRateIncrease: 0,
  maxUserCorrectionRateIncrease: 0,
  maxSafetyRegression: 0,
  maxSecurityRegression: 0,
};

export function evaluateGuardrails(
  champion: FitnessVector,
  challenger: FitnessVector,
  guardrails: FitnessGuardrails = {},
): string[] {
  const g = { ...DEFAULT_GUARDRAILS, ...guardrails };
  const violations: string[] = [];
  const regressionCheck = (
    dim: "hallucinationRate" | "userCorrectionRate",
    max: number,
  ) => {
    const before = champion[dim];
    const after = challenger[dim];
    if (before === undefined || after === undefined) return;
    const delta = after - before;
    if (delta > max) {
      violations.push(`${dim} regressed by ${delta.toFixed(3)} (max allowed ${max})`);
    }
  };
  regressionCheck("hallucinationRate", g.maxHallucinationRateIncrease);
  regressionCheck("userCorrectionRate", g.maxUserCorrectionRateIncrease);

  const inverseRegressionCheck = (dim: "safety" | "security", max: number) => {
    const before = champion[dim];
    const after = challenger[dim];
    if (before === undefined || after === undefined) return;
    const delta = before - after;
    if (delta > max) {
      violations.push(`${dim} regressed by ${delta.toFixed(3)} (max allowed ${max})`);
    }
  };
  inverseRegressionCheck("safety", g.maxSafetyRegression);
  inverseRegressionCheck("security", g.maxSecurityRegression);

  return violations;
}

// --- Novelty search -------------------------------------------------------

/**
 * Structural novelty relative to sibling candidates (same championGroup or
 * same parent): 0 = touches the same fields as an existing sibling, 1 = a
 * structurally distinct strategy. Deliberately a documented key-set/value
 * heuristic, not embedding similarity — no vector infra exists for candidate
 * payloads. "Two candidates that both tweak retrieval weights slightly" and
 * "a candidate that changes retrieval strategy entirely" (the spec's own
 * example) differ in *which* keys they touch and how much values move, both
 * of which this captures.
 */
export function computeNoveltyScore(
  candidatePayload: Record<string, unknown>,
  siblingPayloads: Record<string, unknown>[],
): number {
  if (siblingPayloads.length === 0) return 1;
  const candidateSignature = flattenSignature(candidatePayload);
  let minSimilarity = 1;
  for (const sibling of siblingPayloads) {
    const siblingSignature = flattenSignature(sibling);
    minSimilarity = Math.min(minSimilarity, jaccard(candidateSignature, siblingSignature));
  }
  return Math.round((1 - minSimilarity) * 1000) / 1000;
}

function flattenSignature(obj: Record<string, unknown>, prefix = ""): Set<string> {
  const keys = new Set<string>();
  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const nested of flattenSignature(value as Record<string, unknown>, path)) keys.add(nested);
    } else {
      // Bucket numeric magnitude coarsely (order of magnitude) so two
      // candidates nudging the same weight by different small amounts read
      // as low-novelty siblings, not as unrelated strategies.
      const bucket = typeof value === "number" ? Math.round(value * 4) / 4 : String(value).slice(0, 40);
      keys.add(`${path}=${bucket}`);
    }
  }
  return keys;
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let intersection = 0;
  for (const item of a) if (b.has(item)) intersection += 1;
  const union = a.size + b.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

// --- Lineage-aware proposal -------------------------------------------------

export interface SpawnEvolutionCandidateInput extends ProposedLearningCandidateInput {
  parentCandidateId?: string;
  championGroup?: string;
  mutationType?: string; // weight_adjustment, strategy_change, hybrid, crossover, mutation
  createdFrom?: string; // e.g. "opportunity:<knowledgeGapId>", "manual"
  generatorModel?: string;
  workspaceId?: string | null;
}

/**
 * Proposes a candidate through the existing, audited proposeCandidate() —
 * risk classification, auto-approve eligibility, and ApprovalRequest linkage
 * are untouched — then attaches Evolution Archive metadata (lineage,
 * novelty, championGroup) in a follow-up update. Lineage/novelty are
 * observability metadata, not part of the risk/approval decision itself, so
 * they deliberately don't need to be inside proposeCandidate's own
 * transaction.
 */
export async function proposeEvolutionCandidate(input: SpawnEvolutionCandidateInput) {
  const { parentCandidateId, championGroup, mutationType, createdFrom, generatorModel, workspaceId, ...rest } = input;

  let generation = 0;
  let lineageDepth = 0;
  let rootCandidateId: string | null = null;
  let resolvedChampionGroup = championGroup ?? null;

  if (parentCandidateId) {
    const parent = await db.learningCandidate.findUniqueOrThrow({
      where: { id: parentCandidateId },
      select: { id: true, generation: true, lineageDepth: true, rootCandidateId: true, championGroup: true },
    });
    generation = parent.generation + 1;
    lineageDepth = parent.lineageDepth + 1;
    rootCandidateId = parent.rootCandidateId ?? parent.id;
    resolvedChampionGroup = resolvedChampionGroup ?? parent.championGroup;
  }

  const siblingWhere: Prisma.LearningCandidateWhereInput | null = resolvedChampionGroup
    ? { championGroup: resolvedChampionGroup }
    : parentCandidateId
      ? { parentCandidateId }
      : null;
  const siblings = siblingWhere
    ? await db.learningCandidate.findMany({ where: siblingWhere, select: { proposedPayload: true }, take: 50 })
    : [];
  const noveltyScore = computeNoveltyScore(
    rest.proposedPayload,
    siblings.map((s) => s.proposedPayload as Record<string, unknown>),
  );

  const result = await proposeCandidate(rest);

  const candidate = await db.learningCandidate.update({
    where: { id: result.candidate.id },
    data: {
      parentCandidateId: parentCandidateId ?? null,
      rootCandidateId,
      generation,
      lineageDepth,
      mutationType: mutationType ?? null,
      createdFrom: createdFrom ?? null,
      championGroup: resolvedChampionGroup,
      generatorModel: generatorModel ?? null,
      noveltyScore,
      survivalStatus: result.autoApplied ? "testing" : "generated",
    },
  });

  const nodeId = await syncCandidateNode({ ...candidate, workspaceId: workspaceId ?? null });
  if (parentCandidateId) {
    const parentNodeId = await syncCandidateNode({
      id: parentCandidateId,
      type: candidate.type,
      survivalStatus: "unknown",
      problem: null,
      championGroup: resolvedChampionGroup,
      workspaceId: workspaceId ?? null,
    });
    await linkLearningEdge(nodeId, parentNodeId, "descended_from");
  }
  // Link a handful of championGroup siblings as "competes_with" — capped so
  // a large group doesn't produce an O(n^2) edge fan-out on every proposal.
  if (resolvedChampionGroup) {
    const rivalSiblings = await db.learningCandidate.findMany({
      where: { championGroup: resolvedChampionGroup, id: { not: candidate.id } },
      select: { id: true, type: true, survivalStatus: true, problem: true },
      take: 5,
      orderBy: { createdAt: "desc" },
    });
    for (const rival of rivalSiblings) {
      const rivalNodeId = await syncCandidateNode({ ...rival, championGroup: resolvedChampionGroup, workspaceId: workspaceId ?? null });
      await linkLearningEdge(nodeId, rivalNodeId, "competes_with");
    }
  }

  return { ...result, candidate };
}

/** Record a fitness observation (from a benchmark, eval suite, or shadow run) and recompute fitnessScore. */
export async function recordFitness(
  candidateId: string,
  observedVector: FitnessVector,
  options: { workspaceId?: string | null; merge?: boolean } = {},
) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  const existingVector = (candidate.fitnessVector as FitnessVector | null) ?? {};
  // Only keys with a real (non-undefined) observed value participate in the
  // merge — a caller passing `{ taskSuccess: undefined }` (e.g. "this stage
  // produced no evidence for this dimension") must never blow away a real
  // value recorded by an earlier stage.
  const definedObserved = Object.fromEntries(
    Object.entries(observedVector).filter(([, v]) => v !== undefined),
  ) as FitnessVector;
  const mergedVector = options.merge === false ? definedObserved : { ...existingVector, ...definedObserved };
  const weights = await resolveFitnessWeights({ workspaceId: options.workspaceId });
  const fitnessScore = computeFitnessScore(mergedVector, weights);

  return db.learningCandidate.update({
    where: { id: candidateId },
    data: {
      fitnessVector: mergedVector as unknown as Prisma.InputJsonValue,
      fitnessScore,
      evaluationCount: { increment: 1 },
    },
  });
}

// --- Champion / challenger -------------------------------------------------

export async function getChampion(championGroup: string) {
  return db.learningCandidate.findFirst({
    where: { championGroup, survivalStatus: "champion" },
    orderBy: { createdAt: "desc" },
  });
}

export async function listChallengers(championGroup: string) {
  return db.learningCandidate.findMany({
    where: { championGroup, survivalStatus: "challenger" },
    orderBy: { fitnessScore: "desc" },
  });
}

export interface PromoteChallengerOptions {
  guardrails?: FitnessGuardrails;
  actorId: string;
  reason?: string;
  workspaceId?: string | null;
}

export interface PromotionDecision {
  promoted: boolean;
  reasons: string[];
  championId: string | null;
  challengerId: string;
}

/**
 * Promote a challenger to champion within a championGroup, atomically
 * demoting the previous champion to "superseded". Refuses when the
 * challenger's status/survivalStatus isn't safe to promote, when fitness
 * doesn't actually improve, or when any hard guardrail regresses — a fitness
 * win never overrides a guardrail violation (spec's worked example).
 */
export async function promoteChallenger(
  challengerId: string,
  options: PromoteChallengerOptions,
): Promise<PromotionDecision> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`evolution-promote:${challengerId}`})) IS NULL AS locked`;
    const challenger = await tx.learningCandidate.findUniqueOrThrow({ where: { id: challengerId } });

    const reasons: string[] = [];
    if (challenger.status !== "approved" && challenger.status !== "auto_approved") {
      reasons.push(`candidate status "${challenger.status}" is not applied — cannot promote to champion`);
    }
    if (challenger.survivalStatus === "unsafe" || challenger.survivalStatus === "rejected") {
      reasons.push(`survivalStatus "${challenger.survivalStatus}" cannot be promoted`);
    }
    if (!challenger.championGroup) {
      reasons.push("candidate has no championGroup — cannot determine what it would replace");
    }
    if (reasons.length > 0) {
      return { promoted: false, reasons, championId: null, challengerId };
    }

    const championGroup = challenger.championGroup!;
    const currentChampion = await tx.learningCandidate.findFirst({
      where: { championGroup, survivalStatus: "champion" },
    });

    if (currentChampion) {
      const championVector = (currentChampion.fitnessVector as FitnessVector | null) ?? {};
      const challengerVector = (challenger.fitnessVector as FitnessVector | null) ?? {};
      const violations = evaluateGuardrails(championVector, challengerVector, options.guardrails);
      if (violations.length > 0) {
        return { promoted: false, reasons: violations, championId: currentChampion.id, challengerId };
      }
      if ((challenger.fitnessScore ?? 0) <= (currentChampion.fitnessScore ?? 0)) {
        return {
          promoted: false,
          reasons: [
            `challenger fitness ${challenger.fitnessScore ?? 0} does not exceed champion fitness ${currentChampion.fitnessScore ?? 0}`,
          ],
          championId: currentChampion.id,
          challengerId,
        };
      }
      await tx.learningCandidate.update({
        where: { id: currentChampion.id },
        data: { survivalStatus: "superseded" },
      });
    }

    await tx.learningCandidate.update({
      where: { id: challengerId },
      data: { survivalStatus: "champion" },
    });

    return { promoted: true, reasons: [], championId: currentChampion?.id ?? null, challengerId };
  }).then(async (decision) => {
    if (decision.promoted) {
      const challengerNodeId = await syncCandidateNode({
        id: decision.challengerId,
        type: "candidate",
        survivalStatus: "champion",
        problem: null,
        championGroup: null,
        workspaceId: options.workspaceId ?? null,
      });
      if (decision.championId) {
        const previousNodeId = await syncCandidateNode({
          id: decision.championId,
          type: "candidate",
          survivalStatus: "superseded",
          problem: null,
          championGroup: null,
          workspaceId: options.workspaceId ?? null,
        });
        await linkLearningEdge(challengerNodeId, previousNodeId, "promoted_to");
      }
      await emitLearningEvent({
        eventType: "evolution.champion_promoted",
        sourceType: "learning_candidate",
        sourceId: decision.challengerId,
        workspaceId: options.workspaceId ?? undefined,
        payload: { previousChampionId: decision.championId, reason: options.reason ?? null, actorId: options.actorId },
      }).catch(() => {});
    }
    return decision;
  });
}

// --- Evolution Archive queries ----------------------------------------------

/**
 * Diversity-preserving archive view: top-fitness candidates plus the most
 * structurally novel ones that didn't already make the fitness cut. Never
 * excludes rejected/unsafe/rolled_back candidates from the underlying table
 * (nothing is deleted) — this only controls what a UI highlights first.
 */
export async function getEvolutionArchive(params: {
  championGroup?: string;
  limit?: number;
} = {}) {
  const limit = Math.min(Math.max(params.limit ?? 25, 1), 100);
  const where: Prisma.LearningCandidateWhereInput = params.championGroup
    ? { championGroup: params.championGroup }
    : {};

  const [byFitness, byNovelty] = await Promise.all([
    db.learningCandidate.findMany({
      where,
      orderBy: { fitnessScore: "desc" },
      take: limit,
    }),
    db.learningCandidate.findMany({
      where,
      orderBy: { noveltyScore: "desc" },
      take: limit,
    }),
  ]);

  const byId = new Map<string, (typeof byFitness)[number]>();
  for (const candidate of [...byFitness, ...byNovelty]) byId.set(candidate.id, candidate);
  return [...byId.values()];
}

export async function getCandidateLineage(candidateId: string) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({ where: { id: candidateId } });
  const rootId = candidate.rootCandidateId ?? candidate.id;
  const lineage = await db.learningCandidate.findMany({
    where: { OR: [{ id: rootId }, { rootCandidateId: rootId }] },
    orderBy: [{ generation: "asc" }, { createdAt: "asc" }],
  });
  return lineage;
}
