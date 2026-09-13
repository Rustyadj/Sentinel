import type { AgentWorkspace } from "@prisma/client";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { userHasWorkspacePermission, WorkspaceAccessError } from "@/lib/workspaces/authorization";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";

export const AGENT_WORKSPACE_PERMISSIONS = {
  view: "agent_workspace.view",
  create: "agent_workspace.create",
  operate: "agent_workspace.operate",
  execute: "agent_workspace.execute",
  write: "agent_workspace.write",
  snapshot: "agent_workspace.snapshot",
  restore: "agent_workspace.restore",
  manage: "agent_workspace.manage",
  destroy: "agent_workspace.destroy",
  deleteData: "agent_workspace.delete_data",
} as const;

export type AgentWorkspacePermission =
  typeof AGENT_WORKSPACE_PERMISSIONS[keyof typeof AGENT_WORKSPACE_PERMISSIONS];

export type GrantLevel = "read" | "write" | "admin";

const LEVEL_RANK: Record<GrantLevel, number> = { read: 1, write: 2, admin: 3 };

/** The minimum grant level a delegated (non-owner) principal needs. */
const PERMISSION_MIN_LEVEL: Record<AgentWorkspacePermission, GrantLevel> = {
  [AGENT_WORKSPACE_PERMISSIONS.view]: "read",
  [AGENT_WORKSPACE_PERMISSIONS.create]: "admin",
  [AGENT_WORKSPACE_PERMISSIONS.operate]: "write",
  [AGENT_WORKSPACE_PERMISSIONS.execute]: "write",
  [AGENT_WORKSPACE_PERMISSIONS.write]: "write",
  [AGENT_WORKSPACE_PERMISSIONS.snapshot]: "write",
  [AGENT_WORKSPACE_PERMISSIONS.restore]: "admin",
  [AGENT_WORKSPACE_PERMISSIONS.manage]: "admin",
  [AGENT_WORKSPACE_PERMISSIONS.destroy]: "admin",
  [AGENT_WORKSPACE_PERMISSIONS.deleteData]: "admin",
};

const WRITE_PERMISSIONS = new Set<string>([
  AGENT_WORKSPACE_PERMISSIONS.operate,
  AGENT_WORKSPACE_PERMISSIONS.execute,
  AGENT_WORKSPACE_PERMISSIONS.write,
  AGENT_WORKSPACE_PERMISSIONS.snapshot,
  AGENT_WORKSPACE_PERMISSIONS.restore,
  AGENT_WORKSPACE_PERMISSIONS.manage,
  AGENT_WORKSPACE_PERMISSIONS.destroy,
  AGENT_WORKSPACE_PERMISSIONS.deleteData,
]);

export async function loadWorkspaceOrThrow(agentWorkspaceId: string) {
  const workspace = await db.agentWorkspace.findUnique({ where: { id: agentWorkspaceId } });
  if (!workspace || workspace.status === "DELETED") {
    throw new WorkspaceError("Workspace not found.", "workspace_not_found");
  }
  return workspace;
}

/**
 * Authorise a *human* against one agent workspace. Tenant-level RBAC decides
 * whether the user can act in this Sentinel workspace at all; per-workspace
 * grants decide whether they can touch this particular agent's computer.
 */
export async function requireWorkspaceAccess(
  agentWorkspaceId: string,
  permission: AgentWorkspacePermission,
) {
  const user = await requireUser().catch(() => {
    throw new WorkspaceAccessError("Unauthorized", 401);
  });
  const workspace = await loadWorkspaceOrThrow(agentWorkspaceId);

  if (!(await userHasWorkspacePermission(user.id, workspace.workspaceId, permission))) {
    throw new WorkspaceAccessError(`Missing permission: ${permission}`, 403);
  }

  if (workspace.ownerUserId !== user.id) {
    const grant = await activeUserGrant(agentWorkspaceId, user.id);
    const required = PERMISSION_MIN_LEVEL[permission];
    if (!grant || LEVEL_RANK[grant.level as GrantLevel] < LEVEL_RANK[required]) {
      // Tenant RBAC alone never implies access to another owner's workspace.
      throw new WorkspaceError(
        "This agent workspace has not been shared with you at the required level.",
        "workspace_forbidden",
      );
    }
  }

  assertMutable(workspace, permission);
  return { user, workspace };
}

function assertMutable(workspace: AgentWorkspace, permission: AgentWorkspacePermission) {
  const mutating = WRITE_PERMISSIONS.has(permission);
  if (!mutating) return;
  if (workspace.status === "ARCHIVED" && permission !== AGENT_WORKSPACE_PERMISSIONS.manage) {
    throw new WorkspaceError("This workspace is archived. Unarchive it before making changes.", "workspace_archived");
  }
  if (workspace.locked && permission !== AGENT_WORKSPACE_PERMISSIONS.manage) {
    throw new WorkspaceError("This workspace is locked. Unlock it before making changes.", "workspace_locked");
  }
}

async function activeUserGrant(agentWorkspaceId: string, userId: string) {
  return db.workspacePermission.findFirst({
    where: {
      agentWorkspaceId,
      granteeUserId: userId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
}

/**
 * Authorise an *agent* against one agent workspace. Workspaces belong to their
 * agent by default; any other agent needs an explicit, unexpired grant. There
 * is deliberately no implicit cross-agent path — silent cross-agent mutation is
 * the exact failure mode this subsystem is designed to make impossible.
 */
export async function assertAgentMayAccess(
  workspace: AgentWorkspace,
  actingAgentId: string,
  required: GrantLevel,
) {
  if (workspace.agentId === actingAgentId) return { via: "owner" as const };
  const grant = await db.workspacePermission.findFirst({
    where: {
      agentWorkspaceId: workspace.id,
      granteeAgentId: actingAgentId,
      revokedAt: null,
      OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
    },
  });
  if (!grant || LEVEL_RANK[grant.level as GrantLevel] < LEVEL_RANK[required]) {
    await recordWorkspaceEvent({
      agentWorkspaceId: workspace.id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "delegation.blocked",
      severity: "warn",
      actorAgentId: actingAgentId,
      message: `Agent ${actingAgentId} was denied ${required} access to ${workspace.agentId}'s workspace.`,
      metadata: { requiredLevel: required, ownerAgentId: workspace.agentId },
    });
    throw new WorkspaceError(
      `Agent ${actingAgentId} does not have ${required} access to this workspace. Grant it explicitly first.`,
      "workspace_forbidden",
    );
  }
  return { via: "grant" as const, level: grant.level as GrantLevel };
}

/** Every agent workspace the caller may at least see. */
export async function listAccessibleWorkspaces(filters: { agentId?: string; projectId?: string } = {}) {
  const user = await requireUser();
  const tenantIds = await getAccessibleWorkspaceIds(user.id);
  const permitted: string[] = [];
  for (const id of tenantIds) {
    if (await userHasWorkspacePermission(user.id, id, AGENT_WORKSPACE_PERMISSIONS.view)) permitted.push(id);
  }
  const grants = await db.workspacePermission.findMany({
    where: { granteeUserId: user.id, revokedAt: null },
    select: { agentWorkspaceId: true },
  });
  return db.agentWorkspace.findMany({
    where: {
      status: { not: "DELETED" },
      ...(filters.agentId ? { agentId: filters.agentId } : {}),
      ...(filters.projectId ? { projectId: filters.projectId } : {}),
      OR: [
        { ownerUserId: user.id },
        { workspaceId: { in: permitted } },
        { id: { in: grants.map((grant) => grant.agentWorkspaceId) } },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: { runtimes: { where: { destroyedAt: null }, orderBy: { createdAt: "desc" }, take: 1 } },
  });
}
