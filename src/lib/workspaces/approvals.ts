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

export class ApprovalAlreadyDecidedError extends Error {
  constructor() { super("Only pending approvals can be decided"); this.name = "ApprovalAlreadyDecidedError"; }
}

/**
 * Decide an approval inside the caller's transaction. The decision is a single
 * conditional UPDATE (`status = 'pending'`), not a read followed by an update by
 * id: under READ COMMITTED two concurrent deciders would both read "pending" and
 * both succeed. With the predicate in the UPDATE the second one blocks on the row
 * lock, re-evaluates it after the first commits, matches nothing, and loses.
 * Exactly one decision wins; the loser gets ApprovalAlreadyDecidedError.
 */
export async function decideApprovalIn(tx: Prisma.TransactionClient, id: string, status: Extract<ApprovalStatus, "approved" | "rejected">, reviewerUserId: string, decisionNote?: string) {
  const won = await tx.approvalRequest.updateMany({
    where: { id, status: "pending" },
    data: { status, reviewerUserId, decisionNote, decidedAt: new Date() },
  });
  if (won.count === 0) {
    await tx.approvalRequest.findUniqueOrThrow({ where: { id }, select: { id: true } });
    throw new ApprovalAlreadyDecidedError();
  }
  const approval = await tx.approvalRequest.findUniqueOrThrow({ where: { id } });
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
      details: { previousStatus: "pending", status, decisionNote: decisionNote ?? null },
    },
  });
  return approval;
}

export async function decideApproval(id: string, status: Extract<ApprovalStatus, "approved" | "rejected">, reviewerUserId: string, decisionNote?: string) {
  return db.$transaction((tx) => decideApprovalIn(tx, id, status, reviewerUserId, decisionNote));
}
