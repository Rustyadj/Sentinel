import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteWorkspace, updateWorkspace } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

type Context = { params: Promise<{ id: string }> };

export async function GET(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    await requireWorkspacePermission(id, "workspace.read");
    const workspace = await db.workspace.findUnique({
      where: { id },
      include: { _count: { select: { projects: true, teams: true, approvals: true, meetings: true } } },
    });
    return workspace
      ? NextResponse.json(workspace)
      : NextResponse.json({ error: "Workspace not found" }, { status: 404 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const user = await requireWorkspacePermission(id, "workspace.update");
    return NextResponse.json(await updateWorkspace(id, await req.json(), user.id));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const user = await requireWorkspacePermission(id, "workspace.delete");
    await deleteWorkspace(id, user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
