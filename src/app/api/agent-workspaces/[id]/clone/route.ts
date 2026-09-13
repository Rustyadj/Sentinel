import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { cloneWorkspace } from "@/lib/agent-workspaces/handoff";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.manage);
    const body = await readJson(request);
    const clone = await cloneWorkspace({
      workspace,
      targetAgentId: requireString(body.targetAgentId, "targetAgentId", 200),
      name: requireString(body.name, "name", 120),
      actor: uiActor(user.id),
    });
    return Response.json(serialize({ workspace: clone }), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
