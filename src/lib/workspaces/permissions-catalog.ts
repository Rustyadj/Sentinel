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
  { key: "agent_workspace.view", resource: "agent_workspace", action: "view", description: "View agent workspaces, files, and activity" },
  { key: "agent_workspace.create", resource: "agent_workspace", action: "create", description: "Create agent workspaces" },
  { key: "agent_workspace.operate", resource: "agent_workspace", action: "operate", description: "Start, stop, pause, and restart workspace runtimes" },
  { key: "agent_workspace.execute", resource: "agent_workspace", action: "execute", description: "Run commands and processes inside agent workspaces" },
  { key: "agent_workspace.write", resource: "agent_workspace", action: "write", description: "Modify workspace files and artifacts" },
  { key: "agent_workspace.snapshot", resource: "agent_workspace", action: "snapshot", description: "Create and delete workspace snapshots" },
  { key: "agent_workspace.restore", resource: "agent_workspace", action: "restore", description: "Restore a workspace from a snapshot" },
  { key: "agent_workspace.manage", resource: "agent_workspace", action: "manage", description: "Change limits, permissions, ownership, and archival" },
  { key: "agent_workspace.destroy", resource: "agent_workspace", action: "destroy", description: "Destroy workspace runtimes (data is retained)" },
  { key: "agent_workspace.delete_data", resource: "agent_workspace", action: "delete_data", description: "Permanently delete workspace data volumes" },
  { key: "agents.runtime.view", resource: "agents.runtime", action: "view", description: "View agent runtimes" },
  { key: "agents.runtime.execute", resource: "agents.runtime", action: "execute", description: "Chat with and run jobs on agent runtimes" },
  { key: "agents.runtime.cancel", resource: "agents.runtime", action: "cancel", description: "Cancel a running agent session" },
  { key: "agents.runtime.view_logs", resource: "agents.runtime", action: "view_logs", description: "View agent runtime logs" },
  { key: "agents.runtime.restart", resource: "agents.runtime", action: "restart", description: "Restart an agent runtime" },
  { key: "agents.runtime.configure", resource: "agents.runtime", action: "configure", description: "Change agent runtime configuration" },
  { key: "agents.runtime.elevate", resource: "agents.runtime", action: "elevate", description: "Grant an agent runtime elevated privileges" },
  { key: "agents.runtime.approve_tool", resource: "agents.runtime", action: "approve_tool", description: "Approve a tool-use request from an agent" },
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
  "agent_workspace.view",
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
