import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteTeam, updateTeam } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const team = await db.team.findUniqueOrThrow({ where: { id }, select: { workspaceId: true } });
    const user = await requireWorkspacePermission(team.workspaceId, "team.update");
    return NextResponse.json(await updateTeam(id, await req.json(), user.id));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const team = await db.team.findUniqueOrThrow({ where: { id }, select: { workspaceId: true } });
    const user = await requireWorkspacePermission(team.workspaceId, "team.delete");
    await deleteTeam(id, user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
