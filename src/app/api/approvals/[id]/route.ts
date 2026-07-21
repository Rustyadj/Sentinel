import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { decideApproval } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const approval = await db.approvalRequest.findUniqueOrThrow({ where: { id }, select: { workspaceId: true } });
    const user = await requireWorkspacePermission(approval.workspaceId, "approval.review");
    const body = (await req.json()) as { status?: "approved" | "rejected"; decisionNote?: string };
    if (body.status !== "approved" && body.status !== "rejected") {
      return NextResponse.json({ error: "status must be approved or rejected" }, { status: 400 });
    }
    return NextResponse.json(await decideApproval(id, body.status, user.id, body.decisionNote));
  } catch (error) {
    return accessErrorResponse(error);
  }
}
