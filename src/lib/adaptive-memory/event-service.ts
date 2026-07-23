import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { redactSecrets } from "./security";
import type { AdaptiveEventType } from "./types";

export async function emitAdaptiveEvent(input: {
  type: AdaptiveEventType;
  requestId?: string; runId?: string; userId?: string; agentId?: string;
  organizationId?: string; workspaceId?: string; projectId?: string;
  durationMs?: number; tokenUsage?: number; cost?: number; result?: string;
  error?: string; approvalId?: string; payload?: Record<string, unknown>;
}) {
  const payload = redactSecrets(input.payload ?? {}) as Prisma.InputJsonValue;
  const event = await db.adaptiveEvent.create({ data: {
    type: input.type, requestId: input.requestId, runId: input.runId,
    userId: input.userId, agentId: input.agentId, organizationId: input.organizationId,
    workspaceId: input.workspaceId, projectId: input.projectId,
    durationMs: input.durationMs, tokenUsage: input.tokenUsage, cost: input.cost,
    result: input.result, error: input.error, approvalId: input.approvalId, payload,
  }});
  await writeAuditLog({
    workspaceId: input.workspaceId, projectId: input.projectId,
    approvalRequestId: input.approvalId, userId: input.userId, agentId: input.agentId,
    action: input.type, entityType: "adaptiveEvent", entityId: event.id,
    details: { requestId: input.requestId ?? null, runId: input.runId ?? null, result: input.result ?? null },
  });
  return event;
}
