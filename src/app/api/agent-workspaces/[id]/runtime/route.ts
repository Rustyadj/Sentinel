import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { WorkspaceError, workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, requireString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import {
  destroyRuntime, displayState, pauseRuntime, reconcileRuntime, resumeRuntime,
  restartRuntime, setArchived, startRuntime, stopRuntime,
} from "@/lib/agent-workspaces/service";

const ACTIONS = ["start", "stop", "pause", "resume", "restart", "archive", "unarchive", "reconcile"] as const;
type Action = typeof ACTIONS[number];

/** Runtime lifecycle. Destroying the runtime is DELETE; data deletion lives elsewhere. */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const body = await readJson(request);
    const action = requireString(body.action, "action", 40) as Action;
    if (!ACTIONS.includes(action)) throw new WorkspaceError("Unsupported runtime action.", "invalid_body");

    const permission = action === "archive" || action === "unarchive"
      ? AGENT_WORKSPACE_PERMISSIONS.manage
      : action === "reconcile"
        ? AGENT_WORKSPACE_PERMISSIONS.view
        : AGENT_WORKSPACE_PERMISSIONS.operate;
    const { user, workspace } = await requireWorkspaceAccess(id, permission);
    const actor = uiActor(user.id);

    switch (action) {
      case "start": return Response.json(serialize({ runtime: await startRuntime(workspace, actor) }));
      case "stop": return Response.json(serialize({ runtime: await stopRuntime(workspace, actor) }));
      case "pause": return Response.json(serialize({ runtime: await pauseRuntime(workspace, actor) }));
      case "resume": return Response.json(serialize({ runtime: await resumeRuntime(workspace, actor) }));
      case "restart": return Response.json(serialize({ runtime: await restartRuntime(workspace, actor) }));
      case "reconcile": {
        const runtime = await reconcileRuntime(workspace);
        return Response.json(serialize({ runtime, state: displayState(workspace, runtime) }));
      }
      case "archive":
      case "unarchive": {
        const updated = await setArchived(workspace, action === "archive", actor);
        return Response.json(serialize({ workspace: updated }));
      }
    }
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

/**
 * Destroy the runtime container only. Workspace data is untouched — deleting
 * data is a separate, separately authorised call.
 */
export async function DELETE(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.destroy);
    await destroyRuntime(workspace, uiActor(user.id));
    return Response.json({ ok: true, dataRetained: true });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
