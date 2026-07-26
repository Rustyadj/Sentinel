import { db } from "@/lib/db";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";

export class AdaptiveAccessError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404) { super(message); }
}

export async function requireAdaptiveScope(input: {
  actorUserId: string;
  organizationId?: string | null;
  workspaceId?: string | null;
  projectId?: string | null;
  userId?: string | null;
  permission?: string;
}) {
  if (input.userId && input.userId !== input.actorUserId) {
    throw new AdaptiveAccessError("Cross-user memory access denied.", 403);
  }
  const project = input.projectId ? await db.project.findUnique({
    where: { id: input.projectId },
    select: { id: true, userId: true, workspaceId: true, workspace: { select: { organizationId: true } } },
  }) : null;
  if (input.projectId && !project) throw new AdaptiveAccessError("Project not found.", 404);
  if (project && input.workspaceId && project.workspaceId !== input.workspaceId) {
    throw new AdaptiveAccessError("Project does not belong to the supplied workspace.", 400);
  }

  const workspaceId = input.workspaceId ?? project?.workspaceId ?? null;
  const workspace = workspaceId ? await db.workspace.findUnique({
    where: { id: workspaceId }, select: { id: true, ownerId: true, organizationId: true },
  }) : null;
  if (workspaceId && !workspace) throw new AdaptiveAccessError("Workspace not found.", 404);
  if (input.organizationId && workspace?.organizationId !== input.organizationId) {
    if (workspace) throw new AdaptiveAccessError("Workspace does not belong to the supplied organization.", 400);
  }

  if (input.organizationId && !workspaceId) {
    const organization = await db.organization.findUnique({ where: { id: input.organizationId }, select: { ownerId: true } });
    if (!organization) throw new AdaptiveAccessError("Organization not found.", 404);
    if (organization.ownerId !== input.actorUserId) throw new AdaptiveAccessError("Organization access denied.", 403);
  }

  const owner = project?.userId === input.actorUserId || workspace?.ownerId === input.actorUserId;
  if (!owner && workspaceId && !(await userHasWorkspacePermission(
    input.actorUserId, workspaceId, input.permission ?? "knowledge.write",
  ))) {
    throw new AdaptiveAccessError("Workspace access denied.", 403);
  }
  if (project && !workspaceId && project.userId !== input.actorUserId) {
    throw new AdaptiveAccessError("Project access denied.", 403);
  }
  return { project, workspace, workspaceId };
}

export function adaptiveErrorResponse(error: unknown) {
  if (error instanceof AdaptiveAccessError) {
    return Response.json({ error: error.message }, { status: error.status });
  }
  return Response.json({ error: error instanceof Error ? error.message : "Internal error" }, { status: 500 });
}
