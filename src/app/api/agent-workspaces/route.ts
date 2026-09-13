import { requireUser } from "@/lib/current-user";
import { requireWorkspacePermission, accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, listAccessibleWorkspaces } from "@/lib/agent-workspaces/authorization";
import { createAgentWorkspace, displayState } from "@/lib/agent-workspaces/service";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, optionalString, uiActor, serialize } from "@/lib/agent-workspaces/http";

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const workspaces = await listAccessibleWorkspaces({
      agentId: url.searchParams.get("agentId") ?? undefined,
      projectId: url.searchParams.get("projectId") ?? undefined,
    });
    return Response.json({
      workspaces: serialize(workspaces.map((workspace) => ({
        ...workspace,
        state: displayState(workspace, workspace.runtimes[0] ?? null),
        runtime: workspace.runtimes[0] ?? null,
        runtimes: undefined,
      }))),
    });
  } catch (error) {
    return accessErrorResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const body = await readJson(request);
    const tenantWorkspaceId = requireString(body.tenantWorkspaceId, "tenantWorkspaceId", 200);
    await requireWorkspacePermission(tenantWorkspaceId, AGENT_WORKSPACE_PERMISSIONS.create);

    const workspace = await createAgentWorkspace({
      agentId: requireString(body.agentId, "agentId", 200),
      tenantWorkspaceId,
      ownerUserId: user.id,
      organizationId: optionalString(body.organizationId, "organizationId", 200) ?? null,
      projectId: optionalString(body.projectId, "projectId", 200) ?? null,
      name: requireString(body.name, "name", 120),
      description: optionalString(body.description, "description", 2000),
      runtimeType: optionalString(body.runtimeType, "runtimeType", 40),
      image: optionalString(body.image, "image", 400),
      homePath: optionalString(body.homePath, "homePath", 400),
      resourceLimits: (body.resourceLimits ?? undefined) as never,
      policy: (body.policy ?? undefined) as never,
      actor: uiActor(user.id),
    });
    return Response.json({ workspace: serialize(workspace) }, { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
