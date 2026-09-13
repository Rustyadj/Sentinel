import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, optionalString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { createArtifact, listArtifacts } from "@/lib/agent-workspaces/artifacts";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    return Response.json(serialize({ artifacts: await listArtifacts(id) }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.write);
    const body = await readJson(request);
    const artifact = await createArtifact({
      workspace,
      path: requireString(body.path, "path", 4096),
      name: optionalString(body.name, "name", 200),
      description: optionalString(body.description, "description", 2000),
      projectId: optionalString(body.projectId, "projectId", 200) ?? null,
      chatRoomId: optionalString(body.chatRoomId, "chatRoomId", 200) ?? null,
      actor: uiActor(user.id),
    });
    return Response.json(serialize({ artifact }), { status: 201 });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
