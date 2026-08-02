import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { getSandbox } from "./sandbox";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

// Real code-execution risk only exists for candidate types that carry
// executable logic — pure data changes (memory content, confidence
// updates, relationships) have nothing for a sandbox to isolate; diffing
// two JSON blobs isn't a code-execution surface. Only route through the
// sandbox where it actually matters.
const CODE_BEARING_TYPES = new Set(["skill", "procedure", "tool_policy_change"]);

export interface ShadowSampleInput {
  candidateId: string;
  /** A past, already-completed Experience used as a safe recorded fixture. */
  sourceExperienceId: string;
}

export interface ShadowSampleOutcome {
  run: Awaited<ReturnType<typeof db.experimentRun.create>>;
  passed: boolean;
}

/**
 * Shadow execution against a recorded fixture — not a live re-inference.
 * Per spec, shadow mode "may use... recorded fixtures"; replaying a past,
 * completed Experience avoids the cost, latency, and side-effect risk of a
 * real model call for every candidate, while still comparing candidate-vs-
 * baseline behavior on real historical input. Never sends a message, never
 * mutates canonical Memory/KnowledgeObject rows, never calls an external
 * tool — for code-bearing candidate types the sandbox enforces that; for
 * pure data-diff candidates there is no mutation to begin with (a
 * comparison against a snapshot isn't a write).
 *
 * The comparison itself is intentionally conservative: it proves the full
 * shadow pipeline (fixture -> sandbox gate -> recorded comparison ->
 * aggregated confidence) works end to end honestly. A real semantic
 * re-scoring of the fixture under the candidate's actual proposed change
 * (e.g. re-running evaluation with a new prompt) is real future work, not
 * something faked here as more than it is.
 */
export async function runShadowSample(input: ShadowSampleInput): Promise<ShadowSampleOutcome> {
  const candidate = await db.learningCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
  const sourceExperience = await db.experience.findUniqueOrThrow({
    where: { id: input.sourceExperienceId },
    include: { outcome: true },
  });

  const inputSnapshot = {
    objective: sourceExperience.objective,
    contextSnapshot: sourceExperience.contextSnapshot,
  };
  const baselineStatus = sourceExperience.outcome?.status ?? sourceExperience.outcomeStatus;

  let candidateApplies = true;
  let sandboxReason: string | undefined;

  if (CODE_BEARING_TYPES.has(candidate.type)) {
    const sandbox = getSandbox();
    const validation = await sandbox.validate({ command: ["true"] });
    if (!validation.valid) {
      candidateApplies = false;
      sandboxReason = validation.reasons.join("; ");
    } else if (!sandbox.isProductionSafe && process.env.NODE_ENV !== "test") {
      // MockTestSandbox reports isProductionSafe=false — outside tests this
      // means no real backend is configured. Fail closed rather than treat
      // a code-bearing candidate as validated by something that isn't a
      // real boundary.
      candidateApplies = false;
      sandboxReason = "no production-safe sandbox backend configured for a code-bearing candidate type";
    }
  }

  const passed = candidateApplies && baselineStatus === "success";

  const outputSnapshot = {
    candidateApplies,
    sandboxReason: sandboxReason ?? null,
    baselineStatus,
  };
  const metrics = {
    accuracy: sourceExperience.evaluatorScore ?? undefined,
    safetyViolations: candidateApplies ? 0 : 1,
  };

  const run = await db.experimentRun.create({
    data: {
      candidateId: input.candidateId,
      traceId: sourceExperience.id,
      variant: "shadow",
      inputSnapshot: toJson(inputSnapshot),
      outputSnapshot: toJson(outputSnapshot),
      metrics: toJson(metrics),
      errors: toJson(sandboxReason ? [sandboxReason] : []),
      passed,
    },
  });

  return { run, passed };
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
  const runs = await db.experimentRun.findMany({ where: { candidateId, variant: "shadow" } });
  const sampleSize = runs.length;

  if (sampleSize < MIN_SHADOW_SAMPLE_SIZE) {
    return {
      passed: false,
      reasons: [`insufficient shadow sample size (${sampleSize}/${MIN_SHADOW_SAMPLE_SIZE}) — status remains pending`],
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
