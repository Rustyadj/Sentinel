import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { appendEvolutionEvent, lifecycleStageFor } from "./evolution";
import { removeHypothesisFromGraph, syncHypothesisToGraph } from "./graph";

const SYSTEM_LEVELS: Record<string, 1 | 2 | 3> = {
  prompt: 1,
  formatting: 1,
  memory_tags: 1,
  retrieval_weights: 1,
  question_timing: 1,
  workflow: 2,
  tool: 2,
  planning: 2,
  memory_schema: 2,
  agent_collaboration: 2,
  security: 3,
  credentials: 3,
  production_database: 3,
  financial_system: 3,
  permissions: 3,
  model_provider: 3,
  core_architecture: 3,
};

const HYPOTHESIS_TRANSITIONS: Record<string, string[]> = {
  draft: ["testing"],
  testing: ["validated", "rejected"],
  validated: [],
  rejected: [],
};

export function classifyApprovalLevel(risk: string, affectedSystems: string[]): 1 | 2 | 3 {
  let level: 1 | 2 | 3 = risk === "high" ? 3 : risk === "medium" ? 2 : 1;
  for (const system of affectedSystems) {
    level = Math.max(level, SYSTEM_LEVELS[system] ?? 2) as 1 | 2 | 3;
  }
  return level;
}

export async function createHypothesis(input: {
  title: string;
  problem: string;
  rootCause?: string;
  expectedImprovement: string;
  risk?: string;
  affectedSystems?: string[];
  metrics?: unknown;
  rollbackPlan: string;
  successCriteria: string;
}) {
  const risk = input.risk ?? "low";
  const affectedSystems = input.affectedSystems ?? [];
  const hypothesis = await db.hypothesis.create({
    data: {
      title: input.title,
      problem: input.problem,
      rootCause: input.rootCause ?? null,
      expectedImprovement: input.expectedImprovement,
      risk,
      affectedSystems,
      metrics: (input.metrics ?? []) as Prisma.InputJsonValue,
      rollbackPlan: input.rollbackPlan,
      successCriteria: input.successCriteria,
      approvalLevel: classifyApprovalLevel(risk, affectedSystems),
    },
  });
  await syncHypothesisToGraph(hypothesis);
  await appendEvolutionEvent({
    title: `Hypothesis created: ${hypothesis.title}`,
    stage: "created",
    relatedType: "hypothesis",
    relatedId: hypothesis.id,
    metadata: { approvalLevel: hypothesis.approvalLevel },
  });
  return hypothesis;
}

export async function updateHypothesis(
  id: string,
  input: Partial<{
    title: string;
    problem: string;
    rootCause: string | null;
    expectedImprovement: string;
    risk: string;
    affectedSystems: string[];
    metrics: unknown;
    rollbackPlan: string;
    successCriteria: string;
    status: string;
  }>,
  approval?: { humanUserId?: string },
) {
  const existing = await db.hypothesis.findUniqueOrThrow({ where: { id } });
  if (input.status && input.status !== existing.status && !HYPOTHESIS_TRANSITIONS[existing.status]?.includes(input.status)) {
    throw new Error(`Invalid hypothesis transition: ${existing.status} → ${input.status}`);
  }
  if (input.status === "validated" && existing.approvalLevel >= 2 && !approval?.humanUserId) {
    throw new Error(`Level ${existing.approvalLevel} hypotheses require explicit human approval`);
  }

  // Creation-time classification never drops. If a draft is edited to touch a
  // riskier system, raise it immediately; Level 3 is therefore sticky.
  const approvalLevel = Math.max(
    existing.approvalLevel,
    classifyApprovalLevel(input.risk ?? existing.risk, input.affectedSystems ?? existing.affectedSystems),
  );
  const { metrics, ...fields } = input;
  const hypothesis = await db.hypothesis.update({
    where: { id },
    data: {
      ...fields,
      ...(metrics !== undefined ? { metrics: metrics as Prisma.InputJsonValue } : {}),
      approvalLevel,
    },
  });
  await syncHypothesisToGraph(hypothesis);
  if (input.status && input.status !== existing.status) {
    await appendEvolutionEvent({
      title: `Hypothesis ${input.status}: ${hypothesis.title}`,
      stage: lifecycleStageFor("hypothesis", input.status),
      relatedType: "hypothesis",
      relatedId: hypothesis.id,
      metadata: { from: existing.status, to: input.status, approvedByUserId: approval?.humanUserId },
    });
  }
  return hypothesis;
}

export async function listHypotheses(params?: { status?: string; approvalLevel?: number; limit?: number }) {
  return db.hypothesis.findMany({
    where: {
      ...(params?.status ? { status: params.status } : {}),
      ...(params?.approvalLevel ? { approvalLevel: params.approvalLevel } : {}),
    },
    include: { _count: { select: { experiments: true } } },
    orderBy: { updatedAt: "desc" },
    take: params?.limit ?? 100,
  });
}

export async function getHypothesis(id: string) {
  return db.hypothesis.findUnique({
    where: { id },
    include: { experiments: { include: { benchmarks: true }, orderBy: { startedAt: "desc" } } },
  });
}

export async function deleteHypothesis(id: string) {
  const hypothesis = await db.hypothesis.delete({ where: { id } });
  await removeHypothesisFromGraph(id);
  return hypothesis;
}
