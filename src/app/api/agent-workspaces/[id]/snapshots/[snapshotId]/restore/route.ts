import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, uiActor } from "@/lib/agent-workspaces/http";
import { restoreSnapshot } from "@/lib/agent-workspaces/snapshots";

/** Restore is destructive and never implicit: `confirm: true` is mandatory. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string; snapshotId: string }> }) {
  try {
    const { id, snapshotId } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.restore);
    const body = await readJson(request).catch(() => ({}) as Record<string, unknown>);
    const result = await restoreSnapshot({ workspace, snapshotId, confirm: body.confirm === true, actor: uiActor(user.id) });
    return Response.json(result);
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
