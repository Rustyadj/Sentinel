import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { syncToGraph } from "@/lib/knowledge/sync";

// Never optimize only for the literal task — store why it matters too, so
// later decisions on the same thread can be judged against the underlying
// goal rather than just the surface request.
export async function recordGoal(input: {
  taskRef?: string;
  requestedGoal: string;
  underlyingGoal?: string;
  constraints?: string[];
  successCriteria?: string[];
  hiddenPreferences?: Record<string, unknown>;
  businessImpact?: string;
}) {
  const goal = await db.goal.create({
    data: {
      taskRef: input.taskRef ?? null,
      requestedGoal: input.requestedGoal,
      underlyingGoal: input.underlyingGoal ?? null,
      constraints: input.constraints ?? [],
      successCriteria: input.successCriteria ?? [],
      hiddenPreferences: (input.hiddenPreferences ?? {}) as Prisma.InputJsonValue,
      businessImpact: input.businessImpact ?? null,
    },
  });

  await syncToGraph({
    sourceType: "goal",
    sourceId: goal.id,
    type: "Goal",
    title: goal.requestedGoal,
    summary: goal.underlyingGoal ?? undefined,
    scope: "global",
    metadata: { businessImpact: goal.businessImpact },
  });

  return goal;
}

// Cheap keyword-overlap heuristic, not an LLM call — good enough to flag
// "this action has drifted from what the goal actually said" without the
// cost/latency of a model round-trip on every action. A real semantic
// version can replace this later without changing the call sites.
export function scoreAlignment(goalText: string, actionRef: string): number {
  const goalWords = new Set(
    goalText.toLowerCase().split(/\W+/).filter((w) => w.length > 3)
  );
  const actionWords = actionRef.toLowerCase().split(/\W+/).filter((w) => w.length > 3);
  if (goalWords.size === 0 || actionWords.length === 0) return 0.5;
  const overlap = actionWords.filter((w) => goalWords.has(w)).length;
  return Math.min(overlap / Math.min(goalWords.size, 5), 1);
}

export async function checkGoalAlignment(input: { goalId: string; actionRef: string }) {
  const goal = await db.goal.findUniqueOrThrow({ where: { id: input.goalId } });
  const goalText = `${goal.requestedGoal} ${goal.underlyingGoal ?? ""} ${goal.successCriteria.join(" ")}`;
  const alignmentScore = scoreAlignment(goalText, input.actionRef);

  const check = await db.goalAlignmentCheck.create({
    data: {
      goalId: goal.id,
      actionRef: input.actionRef,
      alignmentScore,
      suggestion:
        alignmentScore < 0.3
          ? `This action doesn't obviously serve "${goal.requestedGoal}" — confirm it still fits before proceeding.`
          : null,
    },
  });
  return check;
}

export async function listGoalAlignmentChecks(params?: { goalId?: string; limit?: number }) {
  return db.goalAlignmentCheck.findMany({
    where: params?.goalId ? { goalId: params.goalId } : {},
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 50,
  });
}
