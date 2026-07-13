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

export async function requireWorkspacePermission(workspaceId: string, permissionKey: string) {
  const user = await requireUser().catch(() => {
    throw new WorkspaceAccessError("Unauthorized", 401);
  });

  const workspace = await db.workspace.findUnique({
    where: { id: workspaceId },
    select: { id: true, ownerId: true },
  });
  if (!workspace) throw new WorkspaceAccessError("Workspace not found", 404);
  if (workspace.ownerId === user.id) return user;

  const assignment = await db.roleAssignment.findFirst({
    where: {
      workspaceId,
      OR: [
        { userId: user.id },
        { team: { memberUserIds: { has: user.id } } },
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

  if (!assignment) {
    throw new WorkspaceAccessError(`Missing permission: ${permissionKey}`, 403);
  }
  return user;
}

export function accessErrorResponse(error: unknown) {
  if (error instanceof WorkspaceAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  const message = error instanceof Error ? error.message : "Internal error";
  return Response.json({ error: message }, { status: 500 });
}
