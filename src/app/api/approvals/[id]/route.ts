import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decideApproval } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { resumeAfterApproval, resumeMissionAfterApproval } from "@/lib/orchestration/orchestrator";
import { resolveGuardianReview } from "@/lib/learning/guardian";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const approval = await db.approvalRequest.findUniqueOrThrow({ where: { id }, select: { workspaceId: true, taskId: true, payload: true } });
    const user = await requireWorkspacePermission(approval.workspaceId, "approval.review");
    const body = (await req.json()) as { status?: "approved" | "rejected"; decisionNote?: string };
    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json({ error: "status must be approved or rejected" }, { status: 400 });
    }
    // Guardian tier-2 ("hold") task gates stash the originating GuardianDecision
    // id on this same ApprovalRequest instead of building a second review
    // surface — a human deciding this request also has to resolve Guardian's
    // own hold via resolveGuardianReview, since that's the only thing that
    // ever flips a "review"-mode GuardianDecision away from "hold" (lisa-loop's
    // ensureGuardianCleared never re-derives this from the approval alone).
    const payload = approval.payload as Record<string, unknown> | null;
    const guardianDecisionId = typeof payload?.guardianDecisionId === "string" ? payload.guardianDecisionId : undefined;
    if (guardianDecisionId) {
      await resolveGuardianReview({ decisionId: guardianDecisionId, reviewerId: user.id, approve: body.status === "approved", notes: body.decisionNote });
    }
    const decided = await decideApproval(id, body.status, user.id, body.decisionNote);
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
