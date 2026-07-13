import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "./audit";
import type { ApprovalStatus } from "./status";

export function listApprovals(workspaceId: string) {
  return db.approvalRequest.findMany({
    where: { workspaceId },
    include: {
      requesterUser: { select: { id: true, name: true, email: true } },
      requesterAgent: { select: { id: true, name: true } },
      reviewer: { select: { id: true, name: true, email: true } },
    },
    orderBy: { createdAt: "desc" },
  });
}

export async function createApproval(input: { workspaceId: string; projectId?: string; title: string; description?: string; type?: string; payload?: Record<string, unknown>; requesterAgentId?: string }, requesterUserId: string) {
  const approval = await db.approvalRequest.create({
    data: {
      ...input,
      requesterUserId: input.requesterAgentId ? null : requesterUserId,
      payload: (input.payload ?? {}) as Prisma.InputJsonValue,
    },
  });
  await writeAuditLog({ workspaceId: input.workspaceId, projectId: input.projectId, approvalRequestId: approval.id, userId: requesterUserId, action: "approval.requested", entityType: "approvalRequest", entityId: approval.id, details: { status: "pending", type: approval.type } });
  return approval;
}

export async function decideApproval(id: string, status: Extract<ApprovalStatus, "approved" | "rejected">, reviewerUserId: string, decisionNote?: string) {
  return db.$transaction(async (tx) => {
    const current = await tx.approvalRequest.findUniqueOrThrow({ where: { id } });
    if (current.status !== "pending") throw new Error("Only pending approvals can be decided");
    const approval = await tx.approvalRequest.update({
      where: { id },
      data: { status, reviewerUserId, decisionNote, decidedAt: new Date() },
    });
    await tx.auditLog.create({
      data: {
        workspaceId: approval.workspaceId,
        projectId: approval.projectId,
        approvalRequestId: approval.id,
        userId: reviewerUserId,
        actorType: "user",
        action: `approval.${status}`,
        entityType: "approvalRequest",
        entityId: approval.id,
        details: { previousStatus: current.status, status, decisionNote: decisionNote ?? null },
      },
    });
    return approval;
  });
}
