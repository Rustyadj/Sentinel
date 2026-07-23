// Sentinel Neural Engine — Experience service (Layer 2)
//
// Hard rule: agents write Experiences. Agents do not directly rewrite
// canonical knowledge — only approved LearningCandidates do that, via
// learning-service.applyLearningCandidate().

import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { emitNeuralEvent } from "./event-service";
import type { ExperienceInput, OutcomeInput } from "./types";

function toJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

export async function startExperience(input: ExperienceInput) {
  const experience = await db.experience.create({
    data: {
      agentId: input.agentId,
      projectId: input.projectId ?? null,
      workspaceId: input.workspaceId ?? null,
      organizationId: input.organizationId ?? null,
      taskId: input.taskId ?? null,
      conversationId: input.conversationId ?? null,
      objective: input.objective,
      contextSnapshot: toJson(input.contextSnapshot ?? {}),
      toolsUsed: input.toolsUsed ?? [],
      knowledgeUsed: input.knowledgeUsed ?? [],
    },
  });

  await emitNeuralEvent({
    type: "experience.started",
    payload: { experienceId: experience.id, agentId: experience.agentId },
    projectId: experience.projectId,
    workspaceId: experience.workspaceId,
  });

  return experience;
}

/** Append an action to the experience's action log (append-only, not a rewrite). */
export async function recordAction(
  experienceId: string,
  action: Record<string, unknown>,
) {
  const existing = await db.experience.findUniqueOrThrow({
    where: { id: experienceId },
    select: { actionsTaken: true },
  });
  const actions = Array.isArray(existing.actionsTaken)
    ? (existing.actionsTaken as unknown[])
    : [];
  return db.experience.update({
    where: { id: experienceId },
    data: { actionsTaken: toJson([...actions, action]) },
  });
}

export interface CompleteExperienceParams {
  experienceId: string;
  outcome: OutcomeInput;
  cost?: number;
  latencyMs?: number;
  outputArtifactIds?: string[];
}

/** Complete an experience and record its Outcome in one transaction. */
export async function completeExperience(params: CompleteExperienceParams) {
  const { experienceId, outcome } = params;

  const [experience] = await db.$transaction([
    db.experience.update({
      where: { id: experienceId },
      data: {
        completedAt: new Date(),
        outcomeStatus: outcome.status,
        cost: params.cost,
        latencyMs: params.latencyMs,
        outputArtifactIds: params.outputArtifactIds ?? undefined,
      },
    }),
    db.outcome.create({
      data: {
        experienceId,
        status: outcome.status,
        metrics: toJson(outcome.metrics ?? {}),
        errors: toJson(outcome.errors ?? []),
        externalSignals: toJson(outcome.externalSignals ?? {}),
        userAccepted: outcome.userAccepted ?? null,
      },
    }),
  ]);

  await emitNeuralEvent({
    type: "experience.completed",
    payload: { experienceId, status: outcome.status },
    projectId: experience.projectId,
    workspaceId: experience.workspaceId,
  });
  await emitNeuralEvent({
    type: "outcome.created",
    payload: { experienceId, status: outcome.status },
    projectId: experience.projectId,
    workspaceId: experience.workspaceId,
  });

  return experience;
}

export async function getExperience(experienceId: string) {
  return db.experience.findUnique({
    where: { id: experienceId },
    include: { outcome: true, evaluations: true, learningCandidates: true },
  });
}

/** List experiences for one agent, most recent first — the seed of "agent brain: experiences". */
export async function listAgentExperiences(agentId: string, limit = 50) {
  return db.experience.findMany({
    where: { agentId },
    orderBy: { createdAt: "desc" },
    take: limit,
    include: { outcome: true },
  });
}
