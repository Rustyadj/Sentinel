// Experiment Orchestrator.
//
// Coordinates the existing, already-built pieces — sandbox validation
// (candidate-executor.ts/sandbox.ts), permanent eval suites
// (eval-compiler.ts), adversarial self-play (adversarial.ts), shadow replay
// (shadow.ts), multi-objective fitness (evolution.ts), and Guardian
// (guardian.ts) — into one governed pipeline, persisting a single
// ExperimentManifest row per run so the whole pipeline invocation is
// reproducible and auditable. Does not reimplement any of those stages.
//
// Stop conditions (spec, Workstream 17): budget exceeded, no meaningful
// improvement, hard guardrail failure, Guardian block, required human
// approval, repeated experiment failure, unsafe candidate, infrastructure
// unavailable. Every early return below sets `stopReason` to one of these.

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { findCandidateExecutor } from "./candidate-executor";
import { runShadowSample, evaluateShadowPromotion } from "./shadow";
import { runEvalSuite } from "./eval-compiler";
import { runAdversarialSelfPlay } from "./adversarial";
import { recordFitness, type FitnessVector } from "./evolution";
import { evaluateGuardian } from "./guardian";
import { checkLearningBudget, type LearningBudgetScope } from "./budgets";
import { emitLearningEvent } from "./event-service";

export type ExperimentStage =
  | "static_validation"
  | "sandbox"
  | "eval_suites"
  | "adversarial"
  | "replay"
  | "shadow"
  | "fitness"
  | "guardian"
  | "promotion_decision"
  | "completed"
  | "stopped";

export type StopReason =
  | "budget_exceeded"
  | "no_meaningful_improvement"
  | "hard_guardrail_failure"
  | "guardian_block"
  | "required_human_approval"
  | "repeated_experiment_failure"
  | "unsafe_candidate"
  | "infrastructure_unavailable";

export interface RunExperimentInput {
  candidateId: string;
  budgetScopes: LearningBudgetScope[];
  workspaceId?: string | null;
  evalSuiteIds?: string[];
  runAdversarial?: boolean;
  fixtureExperienceIds?: string[];
  actorId?: string;
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

async function updateManifest(manifestId: string, data: Prisma.ExperimentManifestUpdateInput) {
  return db.experimentManifest.update({ where: { id: manifestId }, data });
}

/**
 * Runs one candidate through the full governed pipeline. Every stage is
 * best-effort within the pipeline (a stage that finds nothing to do is
 * skipped, not faked as passed) but the pipeline stops immediately —
 * recording `stopReason` — on budget exhaustion, a Guardian block, or an
 * unsafe/rejected candidate.
 */
export async function runExperiment(input: RunExperimentInput) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });

  const manifest = await db.experimentManifest.create({
    data: {
      candidateId: candidate.id,
      candidateVersion: candidate.id,
      stage: "static_validation",
      results: toJson({}),
    },
  });

  const stop = async (reason: StopReason, notes: string) => {
    await updateManifest(manifest.id, {
      stage: "stopped",
      stopReason: reason,
      completedAt: new Date(),
      results: toJson({ stoppedAt: "static_validation", notes }),
    });
    await emitLearningEvent({
      eventType: "experiment_stopped",
      sourceType: "learning_candidate",
      sourceId: candidate.id,
      workspaceId: input.workspaceId ?? undefined,
      severity: "warning",
      payload: { manifestId: manifest.id, reason, notes },
    }).catch(() => {});
    return db.experimentManifest.findUniqueOrThrow({ where: { id: manifest.id } });
  };

  // --- Stage: static validation (budget + safety gate) ---------------------
  const budget = await checkLearningBudget(input.budgetScopes);
  if (!budget.withinBudget) {
    return stop("budget_exceeded", budget.reasons.join("; "));
  }
  if (candidate.survivalStatus === "unsafe" || candidate.survivalStatus === "rejected") {
    return stop("unsafe_candidate", `candidate survivalStatus is "${candidate.survivalStatus}"`);
  }

  const results: Record<string, unknown> = {};

  // --- Stage: sandbox --------------------------------------------------------
  await updateManifest(manifest.id, { stage: "sandbox" });
  const executor = findCandidateExecutor(candidate);
  results.sandbox = { supported: executor !== null, executorName: executor?.name ?? null };

  // --- Stage: permanent eval suites ------------------------------------------
  await updateManifest(manifest.id, { stage: "eval_suites", evalSuiteIds: input.evalSuiteIds ?? [] });
  const suites = input.evalSuiteIds?.length
    ? await db.evalSuite.findMany({ where: { id: { in: input.evalSuiteIds } } })
    : await db.evalSuite.findMany({ where: { category: `${candidate.type}_regressions` } });
  const evalOutcomes = [];
  for (const suite of suites) {
    const outcome = await runEvalSuite({ suiteId: suite.id, candidateId: candidate.id, triggeredBy: "experiment_orchestrator" });
    evalOutcomes.push({ suiteId: suite.id, ...outcome.summary });
  }
  results.evalSuites = evalOutcomes;
  const evalTotal = evalOutcomes.reduce((sum, o) => sum + (o.total as number), 0);
  const evalPassed = evalOutcomes.reduce((sum, o) => sum + (o.passed as number), 0);
  if (evalTotal > 0 && evalPassed < evalTotal) {
    const failedCritical = await db.evalResult.count({
      where: {
        candidateId: candidate.id,
        passed: false,
        evalCase: { severity: "critical" },
      },
    });
    if (failedCritical > 0) {
      await updateManifest(manifest.id, { results: toJson(results) });
      return stop("hard_guardrail_failure", `${failedCritical} critical-severity eval case(s) failed`);
    }
  }

  // --- Stage: adversarial self-play ------------------------------------------
  await updateManifest(manifest.id, { stage: "adversarial" });
  if (input.runAdversarial !== false) {
    const adversarial = await runAdversarialSelfPlay({
      candidateId: candidate.id,
      workspaceId: input.workspaceId ?? null,
      actorId: input.actorId,
    });
    results.adversarial = {
      blocked: adversarial.blockedCount,
      breached: adversarial.breachedCount,
      inconclusive: adversarial.inconclusiveCount,
      regressionEvalCaseIds: adversarial.regressionEvalCaseIds,
    };
    if (adversarial.breachedCount > 0) {
      await updateManifest(manifest.id, { results: toJson(results) });
      return stop("hard_guardrail_failure", `${adversarial.breachedCount} adversarial attack(s) breached the candidate`);
    }
  }

  // --- Stage: replay + shadow -------------------------------------------------
  await updateManifest(manifest.id, { stage: "replay" });
  const fixtureIds =
    input.fixtureExperienceIds ??
    (
      await db.experience.findMany({
        where: { outcomeStatus: { in: ["success", "failure", "partial"] } },
        orderBy: { createdAt: "desc" },
        take: 10,
        select: { id: true },
      })
    ).map((e) => e.id);
  results.replay = { fixtureCount: fixtureIds.length };

  await updateManifest(manifest.id, { stage: "shadow" });
  for (const experienceId of fixtureIds) {
    await runShadowSample({ candidateId: candidate.id, sourceExperienceId: experienceId }).catch(() => null);
  }
  const shadowEvaluation = await evaluateShadowPromotion(candidate.id);
  results.shadow = shadowEvaluation;

  // --- Stage: multi-objective fitness -----------------------------------------
  await updateManifest(manifest.id, { stage: "fitness" });
  const fitnessVector: FitnessVector = {
    taskSuccess: shadowEvaluation.passRate ?? undefined,
    clarificationQuality: evalTotal > 0 ? evalPassed / evalTotal : undefined,
    security: (results.adversarial as { blocked?: number } | undefined)
      ? computeAdversarialSecurityScore(results.adversarial as { blocked: number; breached: number; inconclusive: number })
      : undefined,
  };
  const scored = await recordFitness(candidate.id, fitnessVector, { workspaceId: input.workspaceId });
  results.fitness = { fitnessScore: scored.fitnessScore, fitnessVector: scored.fitnessVector };

  if ((scored.fitnessScore ?? 0) <= 0) {
    await updateManifest(manifest.id, { results: toJson(results) });
    return stop("no_meaningful_improvement", `fitness score ${scored.fitnessScore ?? 0} shows no measurable improvement`);
  }

  // --- Stage: guardian ----------------------------------------------------------
  await updateManifest(manifest.id, { stage: "guardian" });
  const guardianDecision = await evaluateGuardian({
    action: `promote candidate ${candidate.id} (${candidate.type}) after experiment ${manifest.id}`,
    actor: input.actorId ?? "system:experiment-orchestrator",
    candidateId: candidate.id,
    candidateType: candidate.type as never,
    riskLevel: candidate.riskLevel as never,
    workspaceId: input.workspaceId ?? null,
  });
  results.guardian = { verdict: guardianDecision.verdict, tier: guardianDecision.tier, mode: guardianDecision.mode };
  if (guardianDecision.verdict === "block") {
    await updateManifest(manifest.id, { results: toJson(results) });
    return stop("guardian_block", guardianDecision.decision.reasonCodes.join(", "));
  }
  if (guardianDecision.verdict === "hold") {
    await updateManifest(manifest.id, { stage: "promotion_decision", results: toJson(results) });
    return stop("required_human_approval", "Tier 2 candidate requires Guardian review before promotion");
  }

  // --- Stage: promotion decision -------------------------------------------------
  await updateManifest(manifest.id, { stage: "promotion_decision" });
  await db.learningCandidate.update({
    where: { id: candidate.id },
    data: { survivalStatus: candidate.championGroup ? "challenger" : "archive" },
  });
  results.promotion = {
    survivalStatus: candidate.championGroup ? "challenger" : "archive",
    note: "Promotion to champion is a separate, explicit call to promoteChallenger() — this stage only marks the candidate eligible.",
  };

  const completed = await updateManifest(manifest.id, {
    stage: "completed",
    completedAt: new Date(),
    results: toJson(results),
  });

  await emitLearningEvent({
    eventType: "experiment_completed",
    sourceType: "learning_candidate",
    sourceId: candidate.id,
    workspaceId: input.workspaceId ?? undefined,
    payload: { manifestId: manifest.id, fitnessScore: scored.fitnessScore },
  }).catch(() => {});

  return completed;
}

function computeAdversarialSecurityScore(a: { blocked: number; breached: number; inconclusive: number }): number | undefined {
  const total = a.blocked + a.breached;
  if (total === 0) return undefined;
  return Math.round((a.blocked / total) * 1000) / 1000;
}

export async function listExperimentManifests(candidateId: string) {
  return db.experimentManifest.findMany({ where: { candidateId }, orderBy: { startedAt: "desc" } });
}
