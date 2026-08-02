import { db } from "@/lib/db";
import type { Prisma } from "@prisma/client";
import { redactPayload } from "./redaction";

export interface EmitLearningEventInput {
  eventType: string;
  sourceType?: string;
  sourceId?: string;
  agentId?: string;
  userId?: string;
  workspaceId?: string;
  projectId?: string;
  chatRoomId?: string;
  messageId?: string;
  workflowId?: string;
  taskId?: string;
  traceId?: string; // Experience.id, when this event belongs to one
  parentTraceId?: string;
  severity?: "debug" | "info" | "warning" | "error" | "critical";
  payload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
}

// Fire-and-forget by convention at call sites (never let instrumentation
// break the request it's observing) — this function itself still awaits
// the write and lets errors propagate, so callers control that trade-off.
export async function emitLearningEvent(input: EmitLearningEventInput) {
  const { payload, redactedKeys } = redactPayload(input.payload ?? {});

  return db.learningEvent.create({
    data: {
      eventType: input.eventType,
      sourceType: input.sourceType ?? null,
      sourceId: input.sourceId ?? null,
      agentId: input.agentId ?? null,
      userId: input.userId ?? null,
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      chatRoomId: input.chatRoomId ?? null,
      messageId: input.messageId ?? null,
      workflowId: input.workflowId ?? null,
      taskId: input.taskId ?? null,
      traceId: input.traceId ?? null,
      parentTraceId: input.parentTraceId ?? null,
      severity: input.severity ?? "info",
      payload: payload as Prisma.InputJsonValue,
      redactedKeys,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
}

export async function listLearningEvents(params?: {
  traceId?: string;
  agentId?: string;
  workspaceId?: string;
  eventType?: string;
  limit?: number;
}) {
  return db.learningEvent.findMany({
    where: {
      ...(params?.traceId ? { traceId: params.traceId } : {}),
      ...(params?.agentId ? { agentId: params.agentId } : {}),
      ...(params?.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params?.eventType ? { eventType: params.eventType } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: params?.limit ?? 50,
  });
}
