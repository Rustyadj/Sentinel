import { db } from "@/lib/db";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";
import { getOrgRole } from "./organization";
import { canManagePeople, projectRoleAllows } from "./roles";

/** The project role a person holds through an explicit membership row, if any. */
export async function projectMemberRole(userId: string, projectId: string): Promise<string | null> {
  const membership = await db.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  return membership?.role ?? null;
}

/**
 * Whether a person may do `permissionKey` on a project. Three ways in, checked
 * cheapest first: they own it, they were added to it, or their workspace role
 * covers it.
 */
export async function userCanOnProject(
  userId: string,
  project: { id: string; userId: string; workspaceId: string | null },
  permissionKey: string,
): Promise<boolean> {
  if (project.userId === userId) return true;
  const role = await projectMemberRole(userId, project.id);
  if (role && projectRoleAllows(role, permissionKey)) return true;
  return Boolean(project.workspaceId) && userHasWorkspacePermission(userId, project.workspaceId!, permissionKey);
}

/** Who may add and remove people on a project: its owner, or whoever manages the organization. */
export async function userCanShareProject(userId: string, project: { userId: string }): Promise<boolean> {
  if (project.userId === userId) return true;
  return canManagePeople(await getOrgRole(userId));
}

/** Ids of projects a person reaches by ownership or explicit membership. */
export async function reachableProjectIds(userId: string): Promise<string[]> {
  const [owned, joined] = await Promise.all([
    db.project.findMany({ where: { userId }, select: { id: true } }),
    db.projectMember.findMany({ where: { userId }, select: { projectId: true } }),
  ]);
  return [...new Set([...owned.map((p) => p.id), ...joined.map((m) => m.projectId)])];
}

export async function listProjectMembers(projectId: string) {
  const project = await db.project.findUniqueOrThrow({
    where: { id: projectId },
    select: { userId: true, user: { select: { id: true, name: true, email: true } } },
  });
  const members = await db.projectMember.findMany({
    where: { projectId },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return {
    owner: project.user,
    members: members.map((m) => ({ id: m.id, role: m.role, user: m.user, createdAt: m.createdAt })),
  };
}
