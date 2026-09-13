import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { uiActor } from "@/lib/agent-workspaces/http";
import { deleteSnapshot } from "@/lib/agent-workspaces/snapshots";

export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    const { id, snapshotId } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.snapshot);
    await deleteSnapshot(workspace, snapshotId, uiActor(user.id));
    return Response.json({ ok: true });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
