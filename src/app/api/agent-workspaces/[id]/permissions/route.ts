import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess, type GrantLevel } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, optionalString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { grantPermission, listPermissions } from "@/lib/agent-workspaces/handoff";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    return Response.json(serialize({ permissions: await listPermissions(id) }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

/** Explicit sharing. Cross-agent access exists only through this endpoint. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.manage);
    const body = await readJson(request);
    const grant = await grantPermission({
      workspace,
      granteeAgentId: optionalString(body.granteeAgentId, "granteeAgentId", 200) ?? null,
      granteeUserId: optionalString(body.granteeUserId, "granteeUserId", 200) ?? null,
      level: requireString(body.level, "level", 10) as GrantLevel,
      reason: optionalString(body.reason, "reason", 500),
      expiresAt: typeof body.expiresAt === "string" ? new Date(body.expiresAt) : null,
      actor: uiActor(user.id),
    });
    return Response.json(serialize({ permission: grant }), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
