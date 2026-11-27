import { db } from "@/lib/db";
import { canManagePeople, isOrgRole } from "@/lib/people/roles";
import { requireWorkspacePermission, userHasWorkspacePermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";

export async function getVisibleWorkforceOrganization(userId: string, org: { id: string; name: string; ownerId: string | null } | null) {
  if (!org || org.ownerId === userId) return org;
  const membership = await db.organizationMember.findUnique({
    where: { organizationId_userId: { organizationId: org.id, userId } },
    select: { role: true },
  });
  return isOrgRole(membership?.role) ? org : null;
}

export async function canManageDepartments(userId: string, workspaceId: string, organizationId: string, ownerId: string | null) {
  const [workspaceEditor, membership] = await Promise.all([
    userHasWorkspacePermission(userId, workspaceId, "workspace.update"),
    db.organizationMember.findUnique({
      where: { organizationId_userId: { organizationId, userId } },
      select: { role: true },
    }),
  ]);
  return workspaceEditor && (userId === ownerId || (isOrgRole(membership?.role) && canManagePeople(membership.role)));
}

export async function requireDepartmentEditor(workspaceId: string) {
  const user = await requireWorkspacePermission(workspaceId, "workspace.update");
  const workspace = await db.workspace.findUniqueOrThrow({
    where: { id: workspaceId },
    select: { organization: { select: { id: true, ownerId: true } } },
  });
  const org = workspace.organization;
  if (!org || !await canManageDepartments(user.id, workspaceId, org.id, org.ownerId)) {
    throw new WorkspaceAccessError("Department management requires an organization owner or administrator.", 403);
  }
  return { organizationId: org.id, userId: user.id };
}
