import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { findCandidateExecutor, type ShadowFixture } from "./candidate-executor";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export interface ShadowSampleInput {
  candidateId: string;
  /** A past, already-completed Experience used as a safe recorded fixture. */
  sourceExperienceId: string;
}

export interface ShadowSampleOutcome {
  run: Awaited<ReturnType<typeof db.experimentRun.create>>;
  passed: boolean | null;
  unsupported: boolean;
}

/**
 * Shadow execution against a recorded fixture — not a live re-inference.
 * Per spec, shadow mode "may use... recorded fixtures"; replaying a past,
 * completed Experience avoids the cost, latency, and side-effect risk of a
 * real model call for every candidate, while still comparing candidate-vs-
 * baseline behavior on real historical input. Never sends a message, never
 * mutates canonical Memory/KnowledgeObject rows, never calls an external
 * tool — for code-bearing candidate types the sandbox enforces that.
 *
 * The candidate's own proposed artifact is what gets evaluated — see
 * candidate-executor.ts. A candidate type with no registered executor is
 * `unsupported`: recorded honestly, excluded from promotion evidence by
 * evaluateShadowPromotion below, never silently treated as passing.
 */
export async function runShadowSample(input: ShadowSampleInput): Promise<ShadowSampleOutcome> {
  const candidate = await db.learningCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
  const sourceExperience = await db.experience.findUniqueOrThrow({
    where: { id: input.sourceExperienceId },
    include: { outcome: true },
  });

  const fixture: ShadowFixture = {
    experienceId: sourceExperience.id,
    objective: sourceExperience.objective,
    contextSnapshot: sourceExperience.contextSnapshot,
    actionsTaken: sourceExperience.actionsTaken,
    toolsUsed: sourceExperience.toolsUsed,
    outcomeStatus: sourceExperience.outcome?.status ?? sourceExperience.outcomeStatus,
    evaluatorScore: sourceExperience.evaluatorScore,
  };
  const inputSnapshot = { objective: fixture.objective, contextSnapshot: fixture.contextSnapshot };

  const executor = findCandidateExecutor(candidate);
  const unsupported = executor === null;

  let passed: boolean | null = null;
  let score: number | null = null;
  let reasons: string[] = [];
  let safetyViolation = false;

  if (executor) {
    const prepared = await executor.prepare(candidate);
    const result = await executor.execute({ prepared, fixture });
    await executor.cleanup(prepared).catch(() => {});
    passed = result.executed ? result.passed : null;
    score = result.score;
    reasons = result.reasons;
    safetyViolation = result.safetyViolation;
  } else {
    reasons = [`no candidate executor supports type "${candidate.type}" — cannot generate real shadow evidence`];
  }

  const outputSnapshot = {
    unsupported,
    executorName: executor?.name ?? null,
    reasons,
  };
  const metrics = {
    accuracy: score ?? undefined,
    safetyViolations: safetyViolation ? 1 : 0,
  };

  const run = await db.$transaction(async (tx) => {
    const sampleIdentity = `${input.candidateId}:${sourceExperience.id}`;
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`shadow-sample:${sampleIdentity}`})) IS NULL AS locked`;
    const existing = await tx.experimentRun.findFirst({
      where: {
        candidateId: input.candidateId,
        traceId: sourceExperience.id,
        variant: "shadow",
      },
    });
    if (existing) return existing;
    return tx.experimentRun.create({
      data: {
        candidateId: input.candidateId,
        traceId: sourceExperience.id,
        variant: "shadow",
        inputSnapshot: toJson(inputSnapshot),
        outputSnapshot: toJson(outputSnapshot),
        metrics: toJson(metrics),
        errors: toJson(reasons),
        // Stored faithfully as null for "unsupported type" / "no evidence in
        // this fixture" — never coerced to false, which would misrepresent
        // absence-of-evidence as an explicit failure. evaluateShadowPromotion
        // below excludes null (and outputSnapshot.unsupported) runs from the
        // sample count entirely, per the executor contract.
        passed,
      },
    });
  });

  return { run, passed, unsupported };
}

export async function listShadowRuns(candidateId: string) {
  return db.experimentRun.findMany({
    where: { candidateId, variant: "shadow" },
    orderBy: { createdAt: "desc" },
  });
}

// --- Promotion gate --------------------------------------------------------

const MIN_SHADOW_SAMPLE_SIZE = 5;
const MIN_CONFIDENCE_LOWER_BOUND = 0.7;

/**
 * Wilson score interval lower bound — the standard method for a binomial
 * proportion confidence interval at small sample sizes (a naive
 * successes/n ratio is overconfident with few samples; this correctly
 * widens the interval when n is small). z=1.96 is the 95% CI critical value.
 */
function wilsonLowerBound(successes: number, n: number, z = 1.959963985): number {
  if (n === 0) return 0;
  const phat = successes / n;
  const denominator = 1 + (z * z) / n;
  const center = phat + (z * z) / (2 * n);
  const adjustment = z * Math.sqrt((phat * (1 - phat)) / n + (z * z) / (4 * n * n));
  return Math.max(0, (center - adjustment) / denominator);
}

export interface ShadowPromotionEvaluation {
  passed: boolean;
  reasons: string[];
  sampleSize: number;
  passRate: number | null;
  confidenceLowerBound: number | null;
}

/**
 * Do not automatically promote based on one good run — requires both a
 * minimum sample size and a Wilson-lower-bound confidence above threshold.
 * Below minimum sample size, status stays "pending" (not failed, not
 * passed) per spec.
 */
export async function evaluateShadowPromotion(candidateId: string): Promise<ShadowPromotionEvaluation> {
  const storedRuns = await db.experimentRun.findMany({
    where: { candidateId, variant: "shadow", traceId: { not: null } },
    orderBy: { createdAt: "asc" },
  });
  // Defense in depth for rows written before the advisory-lock dedupe existed,
  // or inserted outside the service: one recorded fixture is one sample.
  const deduped = [...new Map(storedRuns.map((run) => [run.traceId!, run])).values()];

  // Unsupported-type runs and "no evidence" runs (executor ran but the
  // fixture gave it nothing to check — e.g. a tool-policy candidate against
  // a fixture that used no tools) carry zero promotion evidence and must
  // never count toward sample size or confidence, per the executor
  // contract in candidate-executor.ts.
  const runs = deduped.filter((run) => {
    const snapshot = run.outputSnapshot as { unsupported?: boolean } | null;
    if (snapshot?.unsupported) return false;
    return run.passed !== null;
  });
  const unsupportedCount = deduped.length - runs.length;
  const sampleSize = runs.length;

  if (sampleSize < MIN_SHADOW_SAMPLE_SIZE) {
    return {
      passed: false,
      reasons: [
        `insufficient shadow sample size (${sampleSize}/${MIN_SHADOW_SAMPLE_SIZE}) — status remains pending`,
        ...(unsupportedCount > 0
          ? [`${unsupportedCount} recorded run(s) excluded: unsupported candidate type or no evidence in fixture`]
          : []),
      ],
      sampleSize,
      passRate: null,
      confidenceLowerBound: null,
    };
  }

  const successes = runs.filter((r) => r.passed).length;
  const passRate = Math.round((successes / sampleSize) * 1000) / 1000;
  const confidenceLowerBound = Math.round(wilsonLowerBound(successes, sampleSize) * 1000) / 1000;
  const reasons: string[] = [];

  if (confidenceLowerBound < MIN_CONFIDENCE_LOWER_BOUND) {
    reasons.push(`shadow confidence lower bound ${confidenceLowerBound} below the required ${MIN_CONFIDENCE_LOWER_BOUND}`);
  }

  const hasSafetyFailure = runs.some((r) => {
    const metrics = r.metrics as { safetyViolations?: number } | null;
    return (metrics?.safetyViolations ?? 0) > 0;
  });
  if (hasSafetyFailure) {
    reasons.push("at least one shadow run recorded a safety violation — hard guardrail, no exceptions");
  }

  await db.learningCandidate.update({
    where: { id: candidateId },
    data: { shadowSampleSize: sampleSize, shadowConfidence: confidenceLowerBound },
  });

  return { passed: reasons.length === 0, reasons, sampleSize, passRate, confidenceLowerBound };
}
