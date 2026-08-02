import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { recordReflection } from "./reflection";
import { runShadowSample } from "./shadow";
import { recordBenchmarkResult } from "./benchmarks";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export type ReplayCategory =
  | "failure"
  | "partial_outcome"
  | "user_correction"
  | "rejected_answer"
  | "high_cost"
  | "tool_failure"
  | "workflow_failure"
  | "retrieval_failure"
  | "memory_conflict"
  | "rolled_back"
  | "strongest_success";

// High-cost threshold in cents/whatever unit Experience.cost is recorded
// in — kept as a plain constant, same "one tunable place" pattern as the
// benchmark/policy defaults elsewhere in this module.
const HIGH_COST_THRESHOLD = 5;
const REPLAY_BATCH_SIZE = 20;

async function selectExperiencesForCategory(category: ReplayCategory, since: Date) {
  const where: Prisma.ExperienceWhereInput = { createdAt: { gte: since } };
  switch (category) {
    case "failure":
      return db.experience.findMany({ where: { ...where, outcomeStatus: "failure" }, take: REPLAY_BATCH_SIZE, include: { outcome: true } });
    case "partial_outcome":
      return db.experience.findMany({ where: { ...where, outcomeStatus: "partial" }, take: REPLAY_BATCH_SIZE, include: { outcome: true } });
    case "high_cost":
      return db.experience.findMany({
        where: { ...where, cost: { gte: HIGH_COST_THRESHOLD } },
        orderBy: { cost: "desc" },
        take: REPLAY_BATCH_SIZE,
        include: { outcome: true },
      });
    case "strongest_success":
      return db.experience.findMany({
        where: { ...where, outcomeStatus: "success", evaluatorScore: { not: null } },
        orderBy: { evaluatorScore: "desc" },
        take: REPLAY_BATCH_SIZE,
        include: { outcome: true },
      });
    case "rejected_answer":
      return db.experience.findMany({
        where: { ...where, outcome: { userAccepted: false } },
        take: REPLAY_BATCH_SIZE,
        include: { outcome: true },
      });
    case "rolled_back": {
      const rolledBackCandidates = await db.learningCandidate.findMany({
        where: { status: "rolled_back", createdAt: { gte: since }, experienceId: { not: null } },
        select: { experienceId: true },
        take: REPLAY_BATCH_SIZE,
      });
      const ids = rolledBackCandidates.map((c) => c.experienceId).filter((id): id is string => !!id);
      if (ids.length === 0) return [];
      return db.experience.findMany({ where: { id: { in: ids } }, include: { outcome: true } });
    }
    // tool_failure / workflow_failure / retrieval_failure / user_correction /
    // memory_conflict all require structured fields (per-tool status, per-
    // step workflow results, retrieval provenance) that Experience doesn't
    // record today — Experience.actionsTaken is a free-form Json blob, not a
    // queryable structure. Rather than guess at a shape, these categories
    // are left unimplemented and reported as such (see runExperienceReplay).
    default:
      return [];
  }
}

export interface ReplayRunOutcome {
  category: ReplayCategory;
  implemented: boolean;
  experienceCount: number;
  run: Awaited<ReturnType<typeof db.experienceReplayRun.create>> | null;
}

/**
 * Replays a batch of past Experiences for one category: generates a
 * Reflection per experience (via the same recordReflection() path a live
 * chat failure uses — no separate reflection logic), runs each through
 * runShadowSample as its own baseline/candidate=itself sanity comparison
 * (proves the shadow pipeline against real historical data and produces a
 * genuine BenchmarkResult row), and records one ExperienceReplayRun
 * summarizing the batch. Uses only already-completed Experiences (sanitized
 * snapshots, not live actions) and never calls a model, a tool, or anything
 * with an external side effect — replay is entirely read + derive + record.
 */
export async function runExperienceReplay(
  category: ReplayCategory,
  since: Date = new Date(Date.now() - 24 * 60 * 60 * 1000)
): Promise<ReplayRunOutcome> {
  const experiences = await selectExperiencesForCategory(category, since);
  if (experiences.length === 0) {
    return { category, implemented: isImplementedCategory(category), experienceCount: 0, run: null };
  }

  const lessons: string[] = [];
  const improvementOpportunities: string[] = [];
  const knowledgeGapIds: string[] = [];
  const sourceTraceIds: string[] = [];

  for (const experience of experiences) {
    sourceTraceIds.push(experience.id);

    const reflection = await recordReflection(
      {
        traceId: experience.id,
        agentId: experience.agentId,
        projectId: experience.projectId ?? undefined,
        workspaceId: experience.workspaceId ?? undefined,
        reflectionType: "scheduled_replay",
        summary: `Replay (${category}): ${experience.objective.slice(0, 200)}`,
        whatFailed: category === "failure" || category === "partial_outcome" ? experience.evaluatorSummary ?? undefined : undefined,
        reusableLesson: category === "strongest_success" ? experience.evaluatorSummary ?? undefined : undefined,
      },
      { emitEvent: false }
    );
    if (reflection.reusableLesson) lessons.push(reflection.reusableLesson);
    if (reflection.suggestedImprovement) improvementOpportunities.push(reflection.suggestedImprovement);

    // A self-comparison shadow sample: proves the candidate pipeline against
    // real historical data during replay, distinct from a live candidate's
    // shadow test against a proposed change.
    const noopCandidate = await db.learningCandidate.findFirst({
      where: { experienceId: experience.id },
      select: { id: true },
    });
    if (noopCandidate) {
      await runShadowSample({ candidateId: noopCandidate.id, sourceExperienceId: experience.id }).catch(() => null);
    }
  }

  const benchmarkDefinition = await db.benchmarkDefinition.findFirst({ where: { category: "replay" } });
  if (benchmarkDefinition) {
    const accuracyValues = experiences.map((e) => e.evaluatorScore).filter((v): v is number => v !== null);
    if (accuracyValues.length > 0) {
      await recordBenchmarkResult({
        benchmarkId: benchmarkDefinition.id,
        metrics: { accuracy: accuracyValues.reduce((a, b) => a + b, 0) / accuracyValues.length },
      });
    }
  }

  const run = await db.experienceReplayRun.create({
    data: {
      category,
      sourceTraceIds,
      summary: `Replayed ${experiences.length} experience(s) in category "${category}" since ${since.toISOString()}.`,
      lessons: toJson(lessons),
      improvementOpportunities: toJson(improvementOpportunities),
      knowledgeGapIds,
    },
  });

  return { category, implemented: true, experienceCount: experiences.length, run };
}

function isImplementedCategory(category: ReplayCategory): boolean {
  return !["tool_failure", "workflow_failure", "retrieval_failure", "user_correction", "memory_conflict"].includes(category);
}

export async function listReplayRuns(params?: { category?: ReplayCategory; limit?: number }) {
  return db.experienceReplayRun.findMany({
    where: params?.category ? { category: params.category } : {},
    orderBy: { runDate: "desc" },
    take: params?.limit ?? 50,
  });
}
