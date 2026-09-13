import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { deleteArtifact, setArtifactPinned } from "@/lib/agent-workspaces/artifacts";

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    const { workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.write);
    const body = await readJson(request);
    return Response.json(serialize({ artifact: await setArtifactPinned(workspace, artifactId, body.pinned === true) }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

/** Removes the artifact record only — the underlying workspace file is kept. */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; artifactId: string }> }) {
  try {
    const { id, artifactId } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.write);
    await deleteArtifact(workspace, artifactId, uiActor(user.id));
    return Response.json({ ok: true, fileRetained: true });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
