import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emitLearningEvent } from "./event-service";

export interface RecordReflectionInput {
  traceId?: string;
  agentId: string;
  workspaceId?: string;
  projectId?: string;
  reflectionType: string; // automatic, failure, success, user_feedback, scheduled_replay, manual
  summary: string;
  whatWorked?: string;
  whatFailed?: string;
  unexpectedResults?: string;
  incorrectAssumptions?: string;
  missingInformation?: string;
  reusableLesson?: string;
  suggestedImprovement?: string;
  shouldCreateSkill?: boolean;
  shouldAskNextTime?: boolean;
  confidence?: number;
}

// Reflection creates evidence and proposals — it never directly modifies
// production behavior itself (see docs/LEARNING_CORE_ON_NEURAL_ENGINE.md).
// `missingInformation` is meant to seed a KnowledgeGap eventually (Phase C,
// not built yet) — left as a plain field for now rather than reaching ahead.
export async function recordReflection(
  input: RecordReflectionInput,
  options: {
    client?: Pick<Prisma.TransactionClient, "reflection" | "learningEvent">;
    emitEvent?: boolean;
  } = {},
) {
  const client = options.client ?? db;
  const reflection = await client.reflection.create({
    data: {
      traceId: input.traceId ?? null,
      agentId: input.agentId,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      reflectionType: input.reflectionType,
      summary: input.summary,
      whatWorked: input.whatWorked ?? null,
      whatFailed: input.whatFailed ?? null,
      unexpectedResults: input.unexpectedResults ?? null,
      incorrectAssumptions: input.incorrectAssumptions ?? null,
      missingInformation: input.missingInformation ?? null,
      reusableLesson: input.reusableLesson ?? null,
      suggestedImprovement: input.suggestedImprovement ?? null,
      shouldCreateSkill: input.shouldCreateSkill ?? false,
      shouldAskNextTime: input.shouldAskNextTime ?? false,
      confidence: input.confidence ?? null,
    },
  });

  if (options.emitEvent !== false) {
    void emitLearningEvent({
      eventType: "reflection_recorded",
      sourceType: "reflection",
      sourceId: reflection.id,
      agentId: input.agentId,
      traceId: input.traceId,
      workspaceId: input.workspaceId,
      payload: { reflectionType: input.reflectionType, shouldCreateSkill: reflection.shouldCreateSkill },
    }, client).catch((err) => console.error("[learning] emitLearningEvent failed (non-fatal):", err));
  }

  return reflection;
}

export async function updateReflectionStatus(id: string, status: "open" | "actioned" | "dismissed") {
  return db.reflection.update({ where: { id }, data: { status } });
}

export async function listReflections(params?: { agentId?: string; status?: string; limit?: number }) {
  return db.reflection.findMany({
    where: {
      ...(params?.agentId ? { agentId: params.agentId } : {}),
      ...(params?.status ? { status: params.status } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 50,
  });
}
