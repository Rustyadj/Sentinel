import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { ApprovalAlreadyDecidedError, decideApprovalIn } from "@/lib/workspaces/approvals";
import { requireUser } from "@/lib/current-user";
import { accessErrorResponse, requireWorkspacePermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { resumeAfterApproval, resumeMissionAfterApproval } from "@/lib/orchestration/orchestrator";
import { GuardianReviewAlreadyResolvedError, resolveGuardianReview } from "@/lib/learning/guardian";
import { HttpError, errorResponse as botErrorResponse, requireBotAdmin } from "@/lib/bots/api";
import { resolveBotTaskApproval } from "@/lib/bots/tasks";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    // Who is asking comes before whether the approval exists: an anonymous caller gets 401 either way, never a 500
    // that tells them an id was not found.
    await requireUser().catch(() => { throw new WorkspaceAccessError("Unauthorized", 401); });
    const approval = await db.approvalRequest.findUnique({ where: { id }, select: { workspaceId: true, taskId: true, payload: true, type: true, status: true } });
    if (!approval) throw new WorkspaceAccessError("Approval not found", 404);
    const user = await requireWorkspacePermission(approval.workspaceId, "approval.review");
    const body = (await req.json()) as { status?: "approved" | "rejected"; decisionNote?: string };
    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json({ error: "status must be approved or rejected" }, { status: 400 });
    }
    // A bot's tool approval is not a plain status flip: approving starts the continuation task and
    // closes the waiting one, rejecting closes it. Deciding it here without that left the bot task
    // WAITING forever behind an approval that no longer showed as pending. It goes through the same
    // resolver the bot task API uses, under the same rule (workspace owner/admin).
    const botPayload = approval.payload as Record<string, unknown> | null;
    if (approval.type === "bot_tool_call" && typeof botPayload?.runId === "string") {
      try {
        const admin = await requireBotAdmin(approval.workspaceId);
        if (approval.status !== "pending") throw new HttpError("This approval has already been decided", 409);
        await resolveBotTaskApproval(botPayload.runId, body.status === "approved" ? "approve" : "deny", { userId: admin.id, isAdmin: true }, { decisionNote: body.decisionNote });
        if (body.status === "rejected") {
          const { recordProductionFailure } = await import("@/lib/learning/production-failures");
          await recordProductionFailure("rejected_approval", { sourceId: id, workspaceId: approval.workspaceId, userId: admin.id, context: { decisionNote: body.decisionNote, taskId: approval.taskId } }).catch(() => undefined);
        }
        return NextResponse.json(await db.approvalRequest.findUniqueOrThrow({ where: { id } }));
      } catch (error) {
        return botErrorResponse(error);
      }
    }
    // Guardian tier-2 ("hold") task gates stash the originating GuardianDecision
    // id on this same ApprovalRequest instead of building a second review
    // surface — a human deciding this request also has to resolve Guardian's
    // own hold via resolveGuardianReview, since that's the only thing that
    // ever flips a "review"-mode GuardianDecision away from "hold" (lisa-loop's
    // ensureGuardianCleared never re-derives this from the approval alone).
    //
    // The approval is decided first and the hold resolved after it, in one
    // transaction: only the request that wins the pending -> decided update
    // may touch the GuardianDecision. A repeated PATCH loses at the first step
    // and leaves the decision as it was, and a hold that is somehow already
    // resolved rolls the approval decision back with it.
    const payload = approval.payload as Record<string, unknown> | null;
    const guardianDecisionId = typeof payload?.guardianDecisionId === "string" ? payload.guardianDecisionId : undefined;
    const status = body.status;
    let decided;
    try {
      decided = await db.$transaction(async (tx) => {
        const row = await decideApprovalIn(tx, id, status, user.id, body.decisionNote);
        if (guardianDecisionId) {
          await resolveGuardianReview({ decisionId: guardianDecisionId, reviewerId: user.id, approve: status === "approved", notes: body.decisionNote }, tx);
        }
        return row;
      });
    } catch (error) {
      if (error instanceof ApprovalAlreadyDecidedError || error instanceof GuardianReviewAlreadyResolvedError) {
        return NextResponse.json({ error: "This approval has already been decided" }, { status: 409 });
      }
      throw error;
    }
    if (body.status === "rejected") {
      const { recordProductionFailure } = await import("@/lib/learning/production-failures");
      await recordProductionFailure("rejected_approval", { sourceId: id, workspaceId: approval.workspaceId, userId: user.id, context: { decisionNote: body.decisionNote, taskId: approval.taskId } }).catch(() => undefined);
    }
    if (body.status === "approved" && approval.taskId) {
      // A collaboration-room approval gate resuming its task is a distinct
      // pipeline from this route's normal request/response cycle, so it
      // runs detached rather than holding this response open on it.
      void resumeAfterApproval(approval.taskId).catch((error) =>
        console.error("[approvals] resumeAfterApproval failed", error),
      );
    } else if (body.status === "approved" && !approval.taskId && payload?.missionLaunch === true) {
      // Same detached-resume pattern as above, for a mission-bridge launch
      // that was gated before any Task existed (see mission-bridge.ts).
      void resumeMissionAfterApproval(id).catch((error) =>
        console.error("[approvals] resumeMissionAfterApproval failed", error),
      );
    }
    return NextResponse.json(decided);
  } catch (error) {
    return accessErrorResponse(error);
  }
}
