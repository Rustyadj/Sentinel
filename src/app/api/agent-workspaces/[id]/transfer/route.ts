import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess, type GrantLevel } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { transferWorkspace } from "@/lib/agent-workspaces/handoff";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.manage);
    const body = await readJson(request);
    const keep = body.keepPreviousAgentAccess;
    const updated = await transferWorkspace({
      workspace,
      toAgentId: requireString(body.toAgentId, "toAgentId", 200),
      reason: requireString(body.reason, "reason", 500),
      keepPreviousAgentAccess: keep === "read" || keep === "write" || keep === "admin" ? (keep as GrantLevel) : null,
      actor: uiActor(user.id),
    });
    return Response.json(serialize({ workspace: updated }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
