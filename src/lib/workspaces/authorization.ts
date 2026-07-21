import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";

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

export async function requireProjectPermission(projectId: string, permissionKey: string) {
  const user = await requireUser().catch(() => {
    throw new WorkspaceAccessError("Unauthorized", 401);
  });
  const project = await db.project.findUnique({
    where: { id: projectId },
    select: { id: true, userId: true, workspaceId: true },
  });
  if (!project) throw new WorkspaceAccessError("Project not found", 404);
  if (project.userId === user.id) return { user, project };
  if (!project.workspaceId || !(await userHasWorkspacePermission(user.id, project.workspaceId, permissionKey))) {
    throw new WorkspaceAccessError("Project not found", 404);
  }
  return { user, project };
}

export function accessErrorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return Response.json({ error: message }, { status: 500 });
}
