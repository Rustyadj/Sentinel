import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decideApproval } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { resumeAfterApproval } from "@/lib/orchestration/orchestrator";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const approval = await db.approvalRequest.findUniqueOrThrow({ where: { id }, select: { workspaceId: true, taskId: true } });
    const user = await requireWorkspacePermission(approval.workspaceId, "approval.review");
    const body = (await req.json()) as { status?: "approved" | "rejected"; decisionNote?: string };
    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json({ error: "status must be approved or rejected" }, { status: 400 });
    }
    const decided = await decideApproval(id, body.status, user.id, body.decisionNote);
    if (body.status === "approved" && approval.taskId) {
      // A collaboration-room approval gate resuming its task is a distinct
      // pipeline from this route's normal request/response cycle, so it
      // runs detached rather than holding this response open on it.
      void resumeAfterApproval(approval.taskId).catch((error) =>
        console.error("[approvals] resumeAfterApproval failed", error),
      );
    }
    return NextResponse.json(decided);
  } catch (error) {
    return accessErrorResponse(error);
  }
}
