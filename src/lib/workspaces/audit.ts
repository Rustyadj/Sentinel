import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export async function writeAuditLog(input: {
  workspaceId?: string | null;
  projectId?: string | null;
  approvalRequestId?: string | null;
  userId?: string | null;
  agentId?: string | null;
  actorType?: "user" | "agent" | "system";
  action: string;
  entityType: string;
  entityId?: string | null;
  details?: Record<string, unknown>;
}) {
  return db.auditLog.create({
    data: {
      workspaceId: input.workspaceId ?? null,
      projectId: input.projectId ?? null,
      approvalRequestId: input.approvalRequestId ?? null,
      userId: input.userId ?? null,
      agentId: input.agentId ?? null,
      actorType: input.actorType ?? (input.userId ? "user" : input.agentId ? "agent" : "system"),
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      details: (input.details ?? {}) as Prisma.InputJsonValue,
    },
  });
}
