import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { appendEvolutionEvent, lifecycleStageFor } from "./evolution";
import { removeExperimentFromGraph, syncExperimentToGraph } from "./graph";
import { getAgentTrustScore, getAutonomyDecision, recordTrustEvent } from "./trust";

const EXPERIMENT_TRANSITIONS: Record<string, string[]> = {
  shadow: ["running", "discarded"],
  running: ["completed", "discarded"],
  completed: ["promoted", "discarded"],
  promoted: [],
  discarded: [],
};

export async function createExperiment(input: {
  hypothesisId?: string;
  type: string;
  version?: string;
  ownerId?: string;
  metrics?: unknown;
}) {
  const hypothesis = input.hypothesisId
    ? await db.hypothesis.findUniqueOrThrow({ where: { id: input.hypothesisId } })
    : null;
  const experiment = await db.experiment.create({
    data: {
      hypothesisId: hypothesis?.id ?? null,
      type: input.type,
      version: input.version ?? "1.0.0",
      ownerId: input.ownerId ?? null,
      metrics: (input.metrics ?? {}) as Prisma.InputJsonValue,
      approvalLevel: hypothesis?.approvalLevel ?? 2,
    },
  });
  await syncExperimentToGraph(experiment);
  await appendEvolutionEvent({
    title: `Experiment entered shadow mode: ${experiment.type}`,
    stage: "shadow",
    relatedType: "experiment",
    relatedId: experiment.id,
    metadata: { approvalLevel: experiment.approvalLevel, hypothesisId: experiment.hypothesisId },
  });
  return experiment;
}

export async function updateExperiment(
  id: string,
  input: Partial<{ type: string; version: string; ownerId: string | null; status: string; metrics: unknown }>,
  approval?: { humanUserId?: string; autonomous?: boolean },
) {
  const existing = await db.experiment.findUniqueOrThrow({ where: { id } });
  if (input.status && input.status !== existing.status && !EXPERIMENT_TRANSITIONS[existing.status]?.includes(input.status)) {
    throw new Error(`Invalid experiment transition: ${existing.status} → ${input.status}`);
  }
  if (input.status === "promoted" && existing.status !== "promoted") {
    const trustScore = existing.ownerId ? await getAgentTrustScore(existing.ownerId) : 50;
    const autonomy = getAutonomyDecision(trustScore, existing.approvalLevel);
    if (!approval?.humanUserId && (!approval?.autonomous || !autonomy.allowed)) {
      throw new Error(autonomy.reason);
    }
    if (existing.approvalLevel === 3 && !approval?.humanUserId) {
      throw new Error("Level 3 experiments always require explicit human approval");
    }
  }

  const { metrics, ...fields } = input;
  const experiment = await db.experiment.update({
    where: { id },
    data: {
      ...fields,
      ...(metrics !== undefined ? { metrics: metrics as Prisma.InputJsonValue } : {}),
      ...(input.status && ["completed", "promoted", "discarded"].includes(input.status)
        ? { completedAt: existing.completedAt ?? new Date() }
        : {}),
    },
  });
  await syncExperimentToGraph(experiment);
  if (input.status && input.status !== existing.status) {
    await appendEvolutionEvent({
      title: `Experiment ${input.status}: ${experiment.type}`,
      stage: lifecycleStageFor("experiment", input.status),
      relatedType: "experiment",
      relatedId: experiment.id,
      metadata: { from: existing.status, to: input.status, approvedByUserId: approval?.humanUserId },
    });
    if (experiment.ownerId && input.status === "discarded") {
      await recordTrustEvent({
        agentId: experiment.ownerId,
        category: "failed_experiment",
        reason: `Experiment ${experiment.id} was discarded`,
      });
    }
    if (experiment.ownerId && input.status === "promoted" && experiment.approvalLevel >= 2) {
      await recordTrustEvent({
        agentId: experiment.ownerId,
        category: "approved_improvement",
        reason: `Experiment ${experiment.id} was approved for production`,
      });
    }
  }
  return experiment;
}

export async function listExperiments(params?: { hypothesisId?: string; status?: string; limit?: number }) {
  return db.experiment.findMany({
    where: {
      ...(params?.hypothesisId ? { hypothesisId: params.hypothesisId } : {}),
      ...(params?.status ? { status: params.status } : {}),
    },
    include: {
      hypothesis: { select: { id: true, title: true, risk: true } },
      benchmarks: { orderBy: { createdAt: "desc" } },
    },
    orderBy: { startedAt: "desc" },
    take: params?.limit ?? 100,
  });
}

export async function getExperiment(id: string) {
  return db.experiment.findUnique({
    where: { id },
    include: { hypothesis: true, benchmarks: { orderBy: { createdAt: "desc" } } },
  });
}

export async function deleteExperiment(id: string) {
  const experiment = await db.experiment.delete({ where: { id } });
  await removeExperimentFromGraph(id);
  return experiment;
}
