import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { uiActor, serialize } from "@/lib/agent-workspaces/http";
import { revokePermission } from "@/lib/agent-workspaces/handoff";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; grantId: string }> }) {
  try {
    const { id, grantId } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.manage);
    return Response.json(serialize({ permission: await revokePermission(workspace, grantId, uiActor(user.id)) }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
