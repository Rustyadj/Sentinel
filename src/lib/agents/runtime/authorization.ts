import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { requireProjectPermission, requireWorkspacePermission, userHasWorkspacePermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { getRuntimeView } from "./service";
import { RuntimeError } from "./errors";
import { toAgentSession } from "./store";
import type { RuntimeView } from "./types";

export const RUNTIME_PERMISSIONS = {
  view: "agents.runtime.view",
  execute: "agents.runtime.execute",
  cancel: "agents.runtime.cancel",
  restart: "agents.runtime.restart",
  configure: "agents.runtime.configure",
  elevate: "agents.runtime.elevate",
  viewLogs: "agents.runtime.view_logs",
  approveTool: "agents.runtime.approve_tool",
} as const;

export type RuntimePermission = typeof RUNTIME_PERMISSIONS[keyof typeof RUNTIME_PERMISSIONS];

export async function listAuthorizedRuntimes() {
  const user = await requireUser();
  const workspaceIds = new Set(await getAccessibleWorkspaceIds(user.id));
  const { listRuntimeViews } = await import("./service");
  const candidates = (await listRuntimeViews()).filter((runtime) => runtime.workspaceId && workspaceIds.has(runtime.workspaceId));
  const visible = await Promise.all(candidates.map(async (runtime) => ({
    runtime,
    allowed: await userHasWorkspacePermission(user.id, runtime.workspaceId!, RUNTIME_PERMISSIONS.view),
  })));
  return visible.filter(({ allowed }) => allowed).map(({ runtime }) => runtime);
}

export async function requireRuntimeAccess(runtimeId: string, permission: RuntimePermission) {
  await requireUser();
  const runtime = await getRuntimeView(runtimeId);
  if (!runtime) throw new RuntimeError("Runtime not found", "runtime_not_found", 404);
  if (!runtime.workspaceId) {
    throw new WorkspaceAccessError("Runtime is not assigned to an authorized workspace", 403);
  }
  const user = await requireWorkspacePermission(runtime.workspaceId, permission);
  return { user, runtime };
}

export async function validateSessionScope(
  runtime: RuntimeView,
  userId: string,
  input: { workspaceId?: string; projectId?: string },
) {
  if (!runtime.workspaceId || input.workspaceId !== runtime.workspaceId) {
    throw new RuntimeError("Session workspace must match the runtime workspace", "workspace_mismatch", 403);
  }
  if (input.projectId) {
    const { user, project } = await requireProjectPermission(input.projectId, RUNTIME_PERMISSIONS.execute);
    if (user.id !== userId || project.workspaceId !== runtime.workspaceId) {
      throw new RuntimeError("Project not found", "project_not_found", 404);
    }
  }
}

export async function requireSessionAccess(sessionId: string, permission: RuntimePermission) {
  const session = await db.agentSession.findUnique({ where: { id: sessionId } });
  if (!session) throw new RuntimeError("Session not found", "session_not_found", 404);
  const { user, runtime } = await requireRuntimeAccess(session.runtimeInstanceId, permission);
  if (session.userId !== user.id && permission !== RUNTIME_PERMISSIONS.view && permission !== RUNTIME_PERMISSIONS.viewLogs) {
    throw new RuntimeError("Session not found", "session_not_found", 404);
  }
  return { user, runtime, session: toAgentSession(session) };
}
