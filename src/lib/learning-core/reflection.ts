import { db } from "@/lib/db";
import { syncReflectionToGraph } from "./graph";
import { recordKnowledgeGap } from "./knowledge-gaps";

export interface ReflectionInput {
  agentId: string;
  taskRef?: string;
  wentWell?: string;
  wentWrong?: string;
  surprises?: string;
  wrongAssumptions?: string;
  missingInfo?: string;
  shouldRemember?: string;
  skillIdea?: string;
  shouldAskMore?: boolean;
}

// Post-task structured reflection. A reflection that surfaces missing
// domain knowledge feeds straight into a KnowledgeGap — that's the loop
// this whole subsystem depends on (reflection notices the gap, curiosity
// scoring decides whether to interrupt next time).
export async function recordReflection(input: ReflectionInput) {
  const reflection = await db.reflection.create({
    data: {
      agentId: input.agentId,
      taskRef: input.taskRef ?? null,
      wentWell: input.wentWell ?? null,
      wentWrong: input.wentWrong ?? null,
      surprises: input.surprises ?? null,
      wrongAssumptions: input.wrongAssumptions ?? null,
      missingInfo: input.missingInfo ?? null,
      shouldRemember: input.shouldRemember ?? null,
      skillIdea: input.skillIdea ?? null,
      shouldAskMore: input.shouldAskMore ?? false,
    },
  });
  await syncReflectionToGraph(reflection);

  if (input.missingInfo) {
    await recordKnowledgeGap({
      agentId: input.agentId,
      topic: input.missingInfo.slice(0, 120),
      description: `Surfaced by reflection on ${input.taskRef ?? "a task"}: ${input.missingInfo}`,
      confidence: 0.3,
    });
  }

  return reflection;
}

export async function listReflections(params?: { agentId?: string; limit?: number }) {
  return db.reflection.findMany({
    where: params?.agentId ? { agentId: params.agentId } : {},
    include: { agent: { select: { id: true, name: true, avatar: true, color: true } } },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 50,
  });
}
