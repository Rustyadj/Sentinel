import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { uiActor } from "@/lib/agent-workspaces/http";
import { readProcessLog } from "@/lib/agent-workspaces/processes";

export async function GET(request: Request, { params }: { params: Promise<{ id: string; processId: string }> }) {
  try {
    const { id, processId } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    const lines = Number.parseInt(new URL(request.url).searchParams.get("lines") ?? "200", 10) || 200;
    return Response.json(await readProcessLog(workspace, processId, lines, uiActor(user.id)));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
