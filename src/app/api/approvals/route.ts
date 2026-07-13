import { NextRequest, NextResponse } from "next/server";
import { createApproval, listApprovals } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

export async function GET(req: NextRequest) {
  try {
    const workspaceId = req.nextUrl.searchParams.get("workspaceId");
    if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
    await requireWorkspacePermission(workspaceId, "approval.read");
    return NextResponse.json({ approvals: await listApprovals(workspaceId) });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.workspaceId || !body.title?.trim()) {
      return NextResponse.json({ error: "Missing required fields: workspaceId, title" }, { status: 400 });
    }
    const user = await requireWorkspacePermission(body.workspaceId, "approval.create");
    return NextResponse.json(await createApproval(body, user.id), { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
