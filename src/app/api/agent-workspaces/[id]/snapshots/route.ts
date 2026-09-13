import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, optionalString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { createSnapshot, listSnapshots } from "@/lib/agent-workspaces/snapshots";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    return Response.json(serialize({ snapshots: await listSnapshots(id) }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.snapshot);
    const body = await readJson(request);
    const snapshot = await createSnapshot({
      workspace,
      name: optionalString(body.name, "name", 120) ?? "",
      reason: requireString(body.reason, "reason", 500),
      actor: uiActor(user.id),
    });
    return Response.json(serialize({ snapshot }), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
