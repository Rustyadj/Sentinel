import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { WorkspaceError, workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, uiActor } from "@/lib/agent-workspaces/http";
import { deleteWorkspaceData } from "@/lib/agent-workspaces/service";

/**
 * Permanent deletion of workspace DATA. Separate endpoint, separate permission
 * and an explicit name confirmation — never bundled with stopping a runtime.
 */
export async function DELETE(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.deleteData);
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    if (body.confirmName !== workspace.name) {
      throw new WorkspaceError("Type the workspace name exactly to confirm data deletion.", "policy_violation");
    }
    await deleteWorkspaceData(workspace, uiActor(user.id));
    return Response.json({ ok: true, deleted: "workspace-data" });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
