import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { deleteRole, updateRole } from "@/lib/workspaces/roles";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

type Context = { params: Promise<{ id: string }> };

export async function PATCH(req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const role = await db.role.findUniqueOrThrow({ where: { id }, select: { workspaceId: true } });
    const user = await requireWorkspacePermission(role.workspaceId, "permission.manage");
    return NextResponse.json(await updateRole(id, await req.json(), user.id));
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const role = await db.role.findUniqueOrThrow({ where: { id }, select: { workspaceId: true } });
    const user = await requireWorkspacePermission(role.workspaceId, "permission.manage");
    await deleteRole(id, user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
