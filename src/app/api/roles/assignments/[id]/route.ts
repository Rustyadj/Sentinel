import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { revokeRoleAssignment } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

type Context = { params: Promise<{ id: string }> };

export async function DELETE(_req: NextRequest, { params }: Context) {
  try {
    const { id } = await params;
    const assignment = await db.roleAssignment.findUniqueOrThrow({ where: { id }, select: { workspaceId: true } });
    const user = await requireWorkspacePermission(assignment.workspaceId, "permission.manage");
    await revokeRoleAssignment(id, user.id);
    return new NextResponse(null, { status: 204 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
