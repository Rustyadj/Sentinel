import { db } from "@/lib/db";

export const PERMISSION_CATALOG = [
  { key: "workspace.read", resource: "workspace", action: "read", description: "View workspace details" },
  { key: "workspace.update", resource: "workspace", action: "update", description: "Edit workspace settings" },
  { key: "workspace.delete", resource: "workspace", action: "delete", description: "Delete the workspace" },
  { key: "team.read", resource: "team", action: "read", description: "View teams" },
  { key: "team.create", resource: "team", action: "create", description: "Create teams" },
  { key: "team.update", resource: "team", action: "update", description: "Edit teams" },
  { key: "team.delete", resource: "team", action: "delete", description: "Delete teams" },
  { key: "permission.read", resource: "permission", action: "read", description: "View roles and permissions" },
  { key: "permission.manage", resource: "permission", action: "manage", description: "Create/edit roles, permissions, and assignments" },
  { key: "approval.read", resource: "approval", action: "read", description: "View approval requests" },
  { key: "approval.create", resource: "approval", action: "create", description: "Submit approval requests" },
  { key: "approval.review", resource: "approval", action: "review", description: "Approve or reject requests" },
  { key: "project.read", resource: "project", action: "read", description: "View projects" },
  { key: "project.create", resource: "project", action: "create", description: "Create projects" },
  { key: "project.update", resource: "project", action: "update", description: "Edit projects" },
  { key: "project.delete", resource: "project", action: "delete", description: "Delete projects" },
  { key: "task.read", resource: "task", action: "read", description: "View tasks" },
  { key: "task.create", resource: "task", action: "create", description: "Create tasks" },
  { key: "task.update", resource: "task", action: "update", description: "Edit tasks" },
  { key: "task.delete", resource: "task", action: "delete", description: "Delete tasks" },
  { key: "meeting.read", resource: "meeting", action: "read", description: "View meetings" },
  { key: "meeting.create", resource: "meeting", action: "create", description: "Schedule meetings" },
  { key: "meeting.update", resource: "meeting", action: "update", description: "Edit meetings" },
  { key: "meeting.delete", resource: "meeting", action: "delete", description: "Delete meetings" },
  { key: "document.read", resource: "document", action: "read", description: "View documents" },
  { key: "document.create", resource: "document", action: "create", description: "Create documents" },
  { key: "document.update", resource: "document", action: "update", description: "Edit documents" },
  { key: "knowledge.read", resource: "knowledge", action: "read", description: "Read governed knowledge and retrieval traces" },
  { key: "knowledge.write", resource: "knowledge", action: "write", description: "Submit memory and skill candidates" },
  { key: "knowledge.approve", resource: "knowledge", action: "approve", description: "Approve and roll back governed knowledge" },
  { key: "workflow.read", resource: "workflow", action: "read", description: "Read workflow proposals and health" },
  { key: "workflow.write", resource: "workflow", action: "write", description: "Propose workflow changes" },
  { key: "workflow.run", resource: "workflow", action: "run", description: "Run approved workflows" },
  { key: "agent.read", resource: "agent", action: "read", description: "Read agent capabilities and run state" },
  { key: "agent.delegate", resource: "agent", action: "delegate", description: "Create bounded delegated runs" },
  { key: "agent.cancel", resource: "agent", action: "cancel", description: "Cancel delegated runs" },
  { key: "agent.feedback", resource: "agent", action: "feedback", description: "Submit run feedback" },
  { key: "mcp.manage", resource: "mcp", action: "manage", description: "Provision and revoke MCP clients" },
  { key: "run.read", resource: "run", action: "read", description: "Read authorized run trajectories" },
  { key: "note.write", resource: "note", action: "write", description: "Create internal notes" },
  { key: "message.read", resource: "message", action: "read", description: "Read internal conversation messages" },
  { key: "message.write", resource: "message", action: "write", description: "Append internal conversation messages" },
] as const;

const MEMBER_PERMISSION_KEYS = [
  "workspace.read",
  "team.read",
  "permission.read",
  "approval.read",
  "approval.create",
  "project.read",
  "task.read",
  "task.create",
  "task.update",
  "meeting.read",
  "document.read",
  "knowledge.read",
  "knowledge.write",
  "workflow.read",
  "workflow.write",
  "agent.read",
  "run.read",
  "note.write",
  "message.read",
  "message.write",
] as const;

export async function seedWorkspacePermissions(workspaceId: string) {
  await db.$transaction(
    PERMISSION_CATALOG.map((permission) =>
      db.permission.upsert({
        where: { workspaceId_key: { workspaceId, key: permission.key } },
        update: {},
        create: { ...permission, workspaceId },
      })
    )
  );
}

async function upsertSystemRole(workspaceId: string, name: string, permissionKeys: readonly string[]) {
  const permissions = await db.permission.findMany({
    where: { workspaceId, key: { in: [...permissionKeys] } },
    select: { id: true },
  });

  const description = name === "Owner" ? "Full access to this workspace" : "Baseline access for workspace members";
  return db.role.upsert({
    where: { workspaceId_name: { workspaceId, name } },
    update: { system: true, permissions: { set: permissions.map((p) => ({ id: p.id })) } },
    create: {
      workspaceId,
      name,
      system: true,
      description,
      permissions: { connect: permissions.map((p) => ({ id: p.id })) },
    },
  });
}

export async function ensureSystemRoles(workspaceId: string) {
  await seedWorkspacePermissions(workspaceId);
  const allKeys = PERMISSION_CATALOG.map((p) => p.key);
  const [ownerRole, memberRole] = await Promise.all([
    upsertSystemRole(workspaceId, "Owner", allKeys),
    upsertSystemRole(workspaceId, "Member", MEMBER_PERMISSION_KEYS),
  ]);
  return { ownerRole, memberRole };
}

export async function ensureMemberAccess(workspaceId: string, userId: string) {
  const existing = await db.roleAssignment.findFirst({ where: { workspaceId, userId } });
  if (existing) return existing;

  const { memberRole } = await ensureSystemRoles(workspaceId);
  return db.roleAssignment.create({
    data: { workspaceId, roleId: memberRole.id, userId },
  });
}
