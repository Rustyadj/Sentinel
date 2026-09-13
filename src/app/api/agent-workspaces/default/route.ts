import { requireUser } from "@/lib/current-user";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { resolveDefaultAgentWorkspace } from "@/lib/agent-workspaces/defaults";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { requireString, serialize } from "@/lib/agent-workspaces/http";
import { accessErrorResponse } from "@/lib/workspaces/authorization";

/** Authoritative read path for requests such as “Lisa's computer”. */
export async function GET(request: Request) {
  try {
    await requireUser();
    const agentId = requireString(new URL(request.url).searchParams.get("agentId"), "agentId", 200);
    const workspace = await resolveDefaultAgentWorkspace({ agentId });
    await requireWorkspaceAccess(workspace.id, AGENT_WORKSPACE_PERMISSIONS.view);
    return Response.json({ workspace: serialize(workspace) });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
