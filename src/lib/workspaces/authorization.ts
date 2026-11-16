import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { projectRoleAllows } from "@/lib/people/roles";

export class WorkspaceAccessError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 401 | 403 | 404
  ) {
    super(message);
  }
}

export async function userHasWorkspacePermission(
  userId: string,
  workspaceId: string,
  permissionKey: string
) {
  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { ownerId: true },
  });
  if (!workspace) return false;
  if (workspace.ownerId === userId) return true;

  const assignment = await db.roleAssignment.findFirst({
    where: {
      workspaceId,
      OR: [
        { userId },
        { team: { memberUserIds: { has: userId } } },
      ],
      AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }],
      role: {
        permissions: {
          some: { OR: [{ key: permissionKey }, { key: "*" }] },
        },
      },
    },
    select: { id: true },
  });
  return Boolean(assignment);
}

export async function requireWorkspacePermission(workspaceId: string, permissionKey: string) {
  const user = await requireUser().catch(() => {
    throw new WorkspaceAccessError("Unauthorized", 401);
  });

  const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true } });
  if (!workspace) throw new WorkspaceAccessError("Workspace not found", 404);
  if (!(await userHasWorkspacePermission(user.id, workspaceId, permissionKey))) {
    throw new WorkspaceAccessError(`Missing permission: ${permissionKey}`, 403);
  }
  return user;
}

/**
 * Whether a named user holds a project permission, without reading the request
 * session. For callers acting on a user's behalf outside an HTTP request (bot
 * runs, workers). Same rules as requireProjectPermission, which delegates here.
 */
export async function userHasProjectPermission(userId: string, projectId: string, permissionKey: string) {
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, workspaceId: true },
  });
  if (!project) return { allowed: false as const, project: null };
  if (project.userId === userId) return { allowed: true as const, project };
  // Someone added to the project holds that project's role and nothing wider.
  const membership = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  if (membership && projectRoleAllows(membership.role, permissionKey)) return { allowed: true as const, project };
  const allowed = Boolean(project.workspaceId) && (await userHasWorkspacePermission(userId, project.workspaceId!, permissionKey));
  return { allowed, project };
}

export async function requireProjectPermission(projectId: string, permissionKey: string) {
  const user = await requireUser().catch(() => {
    throw new WorkspaceAccessError("Unauthorized", 401);
  });
  const { allowed, project } = await userHasProjectPermission(user.id, projectId, permissionKey);
  if (!project || !allowed) throw new WorkspaceAccessError("Project not found", 404);
  return { user, project };
}

export function accessErrorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return Response.json({ error: message }, { status: 500 });
}
