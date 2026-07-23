// Sentinel Neural Engine — Evaluation service (Layer 2)
//
// Scores a completed Experience. Does not itself mutate canonical knowledge —
// that only happens via approved LearningCandidates (learning-service).

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { emitNeuralEvent } from "./event-service";
import { recordCompetencyEvidence } from "./agent-profile-service";
import type { EvaluationInput } from "./types";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export async function createEvaluation(input: EvaluationInput) {
  const evaluation = await db.evaluation.create({
    data: {
      experienceId: input.experienceId,
      evaluatorAgentId: input.evaluatorAgentId ?? null,
      successScore: input.successScore ?? null,
      qualityScore: input.qualityScore ?? null,
      efficiencyScore: input.efficiencyScore ?? null,
      safetyScore: input.safetyScore ?? null,
      confidence: input.confidence ?? 0.5,
      critique: input.critique ?? null,
      evidence: toJson(input.evidence ?? {}),
    },
  });

  const experience = await db.experience.update({
    where: { id: input.experienceId },
    data: {
      evaluatorScore: input.successScore ?? undefined,
      evaluatorSummary: input.critique ?? undefined,
    },
  });

  // Feed the outcome back into the evaluating agent's competency for the
  // task's domain (using the experience's objective as a coarse domain key
  // for Phase A — a real domain taxonomy is Phase E scope).
  if (input.successScore != null) {
    await recordCompetencyEvidence(
      experience.agentId,
      coarseDomain(experience.objective),
      input.successScore,
      input.successScore >= 0.5,
    );
  }

  await emitNeuralEvent({
    type: "evaluation.completed",
    payload: { evaluationId: evaluation.id, experienceId: input.experienceId },
    projectId: experience.projectId,
    workspaceId: experience.workspaceId,
  });

  return evaluation;
}

export async function getEvaluation(evaluationId: string) {
  return db.evaluation.findUnique({
    where: { id: evaluationId },
    include: { experience: true, learningCandidates: true },
  });
}

export async function listExperienceEvaluations(experienceId: string) {
  return db.evaluation.findMany({
    where: { experienceId },
    orderBy: { createdAt: "desc" },
  });
}

/** Coarse, deterministic domain bucketing until a real taxonomy exists. */
export function coarseDomain(objective: string): string {
  return objective.trim().slice(0, 40).toLowerCase() || "general";
}
