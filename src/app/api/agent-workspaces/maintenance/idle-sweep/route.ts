import { requireUser } from "@/lib/current-user";
import { accessErrorResponse, requireWorkspacePermission } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString } from "@/lib/agent-workspaces/http";
import { sweepIdleWorkspaces } from "@/lib/agent-workspaces/idle";

/**
 * Release compute from idle workspaces. Scoped to one tenant workspace so the
 * caller's operate permission is checked against something concrete.
 */
export async function POST(request: Request) {
  try {
    await requireUser();
    const body = await readJson(request);
    await requireWorkspacePermission(
      requireString(body.tenantWorkspaceId, "tenantWorkspaceId", 200),
      AGENT_WORKSPACE_PERMISSIONS.operate,
    );
    return Response.json(await sweepIdleWorkspaces());
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
