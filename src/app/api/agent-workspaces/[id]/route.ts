import { db } from "@/lib/db";
import { accessErrorResponse } from "@/lib/workspaces/authorization";
import { AGENT_WORKSPACE_PERMISSIONS, requireWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { workspaceErrorResponse } from "@/lib/agent-workspaces/errors";
import { readJson, optionalString, uiActor, serialize } from "@/lib/agent-workspaces/http";
import { displayState, getStats, reconcileRuntime, setLocked, updateLimits, workspaceIdentity } from "@/lib/agent-workspaces/service";
import { parseLimits, parsePolicy } from "@/lib/agent-workspaces/policy";
import { gitSummary } from "@/lib/agent-workspaces/git";
import { browserRuntimeStatus } from "@/lib/agent-workspaces/browser";

/** Full operational view: reconciled runtime state, live stats, repo context. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.view);
    const runtime = await reconcileRuntime(workspace).catch(() => null);
    const stats = runtime?.state === "RUNNING" ? await getStats(workspace).catch(() => null) : null;
    const repository = runtime?.state === "RUNNING" ? await gitSummary(workspace, undefined, uiActor(user.id)) : null;
    const [snapshotCount, artifactCount, processCount] = await Promise.all([
      db.workspaceSnapshot.count({ where: { agentWorkspaceId: workspace.id, status: "ready" } }),
      db.workspaceArtifact.count({ where: { agentWorkspaceId: workspace.id } }),
      db.workspaceProcess.count({ where: { agentWorkspaceId: workspace.id, status: "running" } }),
    ]);

    return Response.json(serialize({
      workspace,
      identity: workspaceIdentity(workspace, runtime),
      state: displayState(workspace, runtime),
      runtime,
      stats,
      repository,
      limits: parseLimits(workspace.resourceLimits),
      policy: parsePolicy(workspace.policy),
      counts: { snapshots: snapshotCount, artifacts: artifactCount, runningProcesses: processCount },
      browserRuntime: browserRuntimeStatus(),
    }));
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    const { user, workspace } = await requireWorkspaceAccess(id, AGENT_WORKSPACE_PERMISSIONS.manage);
    const body = await readJson(request);
    const actor = uiActor(user.id);

    let current = workspace;
    if (body.resourceLimits !== undefined) current = await updateLimits(current, body.resourceLimits, actor);
    if (typeof body.locked === "boolean") current = await setLocked(current, body.locked, actor);

    const name = optionalString(body.name, "name", 120);
    const description = optionalString(body.description, "description", 2000);
    if (name !== undefined || description !== undefined) {
      current = await db.agentWorkspace.update({
        where: { id: current.id },
        data: { ...(name !== undefined ? { name } : {}), ...(description !== undefined ? { description } : {}) },
      });
    }
    return Response.json({ workspace: serialize(current) });
  } catch (error) {
    if (error instanceof Error && error.name === "WorkspaceAccessError") return accessErrorResponse(error);
    return workspaceErrorResponse(error);
  }
}
