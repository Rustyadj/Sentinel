import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { uiActor, serialize } from "@/lib/agent-workspaces/http";
import { stopProcess } from "@/lib/agent-workspaces/processes";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; processId: string }> }) {
  try {
    const { id, processId } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.execute);
    return Response.json(serialize({ process: await stopProcess(workspace, processId, uiActor(user.id)) }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
