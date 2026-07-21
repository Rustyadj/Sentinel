import { db } from "@/lib/db";
import { writeAuditLog } from "./audit";

export function listRoles(workspaceId: string) {
  return db.role.findMany({
    where: { workspaceId },
    include: {
      permissions: true,
      assignments: { include: { user: { select: { id: true, name: true, email: true } }, agent: { select: { id: true, name: true } }, team: { select: { id: true, name: true } } } },
    },
    orderBy: { name: "asc" },
  });
}

export function listPermissions(workspaceId: string) {
  return db.permission.findMany({ where: { workspaceId }, orderBy: [{ resource: "asc" }, { action: "asc" }] });
}

export async function createRole(input: { workspaceId: string; name: string; description?: string; permissionIds?: string[] }, userId: string) {
  const role = await db.role.create({
    data: {
      workspaceId: input.workspaceId,
      name: input.name,
      description: input.description,
      permissions: input.permissionIds?.length ? { connect: input.permissionIds.map((id) => ({ id })) } : undefined,
    },
    include: { permissions: true },
  });
  await writeAuditLog({ workspaceId: input.workspaceId, userId, action: "role.created", entityType: "role", entityId: role.id, details: { name: role.name } });
  return role;
}

export async function createPermission(input: { workspaceId: string; key: string; resource: string; action: string; description?: string }, userId: string) {
  const permission = await db.permission.create({ data: input });
  await writeAuditLog({ workspaceId: input.workspaceId, userId, action: "permission.created", entityType: "permission", entityId: permission.id, details: { key: permission.key } });
  return permission;
}

export async function assignRole(input: { workspaceId: string; roleId: string; userId?: string; agentId?: string; teamId?: string; expiresAt?: Date }, actorUserId: string) {
  const subjects = [input.userId, input.agentId, input.teamId].filter(Boolean);
  if (subjects.length !== 1) throw new Error("Exactly one subject is required");
  const assignment = await db.roleAssignment.create({ data: input });
  await writeAuditLog({ workspaceId: input.workspaceId, userId: actorUserId, action: "role.assigned", entityType: "roleAssignment", entityId: assignment.id, details: { roleId: input.roleId, subjectId: subjects[0], expiresAt: input.expiresAt?.toISOString() ?? null } });
  return assignment;
}

/** Time-boxes a user's own role to an agent — a delegation, not a permanent grant. */
export async function delegateRoleToAgent(
  input: { workspaceId: string; roleId: string; agentId: string; expiresAt: Date },
  delegatingUserId: string
) {
  if (input.expiresAt <= new Date()) throw new Error("expiresAt must be in the future");
  const assignment = await db.roleAssignment.create({
    data: { workspaceId: input.workspaceId, roleId: input.roleId, agentId: input.agentId, expiresAt: input.expiresAt, delegatedById: delegatingUserId },
  });
  await writeAuditLog({ workspaceId: input.workspaceId, userId: delegatingUserId, action: "role.delegated", entityType: "roleAssignment", entityId: assignment.id, details: { roleId: input.roleId, agentId: input.agentId, expiresAt: input.expiresAt.toISOString() } });
  return assignment;
}

export async function revokeRoleAssignment(id: string, actorUserId: string) {
  const assignment = await db.roleAssignment.findUniqueOrThrow({ where: { id } });
  await writeAuditLog({ workspaceId: assignment.workspaceId, userId: actorUserId, action: "role.assignment_revoked", entityType: "roleAssignment", entityId: id, details: { roleId: assignment.roleId } });
  return db.roleAssignment.delete({ where: { id } });
}

export async function updateRole(
  id: string,
  input: { name?: string; description?: string | null; permissionIds?: string[] },
  userId: string
) {
  const role = await db.role.update({
    where: { id },
    data: {
      name: input.name,
      description: input.description,
      ...(input.permissionIds
        ? { permissions: { set: input.permissionIds.map((permissionId) => ({ id: permissionId })) } }
        : {}),
    },
    include: { permissions: true },
  });
  await writeAuditLog({ workspaceId: role.workspaceId, userId, action: "role.updated", entityType: "role", entityId: id, details: { name: role.name, permissionIds: input.permissionIds } });
  return role;
}

export async function deleteRole(id: string, userId: string) {
  const role = await db.role.findUniqueOrThrow({ where: { id } });
  if (role.system) throw new Error("System roles cannot be deleted");
  await writeAuditLog({ workspaceId: role.workspaceId, userId, action: "role.deleted", entityType: "role", entityId: id, details: { name: role.name } });
  return db.role.delete({ where: { id } });
}
