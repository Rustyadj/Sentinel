import { NextRequest, NextResponse } from "next/server";
import { assignRole, delegateRoleToAgent } from "@/lib/workspaces";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    if (!body.workspaceId || !body.roleId) {
      return NextResponse.json({ error: "Missing required fields: workspaceId, roleId" }, { status: 400 });
    }
    const user = await requireWorkspacePermission(body.workspaceId, "permission.manage");

    if (body.expiresAt) {
      if (!body.agentId) {
        return NextResponse.json({ error: "expiresAt (delegation) requires agentId" }, { status: 400 });
      }
      const assignment = await delegateRoleToAgent(
        { workspaceId: body.workspaceId, roleId: body.roleId, agentId: body.agentId, expiresAt: new Date(body.expiresAt) },
        user.id
      );
      return NextResponse.json(assignment, { status: 201 });
    }

    return NextResponse.json(await assignRole(body, user.id), { status: 201 });
  } catch (error) {
    return accessErrorResponse(error);
  }
}
