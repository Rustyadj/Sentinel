import type { AgentWorkspace, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { getRuntimeProvider } from "./providers";
import { createAgentWorkspace, currentRuntime, specFor, type ActorContext } from "./service";
import type { GrantLevel } from "./authorization";

const LEVELS: GrantLevel[] = ["read", "write", "admin"];

/**
 * Share a workspace with another agent or user. Grants are explicit, levelled,
 * revocable and optionally time-bounded — there is no implicit sharing path
 * anywhere else in the subsystem.
 */
export async function grantPermission(input: {
  workspace: AgentWorkspace;
  granteeAgentId?: string | null;
  granteeUserId?: string | null;
  level: GrantLevel;
  reason?: string;
  expiresAt?: Date | null;
  actor: ActorContext;
}) {
  const { workspace, actor } = input;
  const agentId = input.granteeAgentId?.trim() || null;
  const userId = input.granteeUserId?.trim() || null;
  if (Boolean(agentId) === Boolean(userId)) {
    throw new WorkspaceError("Specify exactly one grantee: an agent or a user.", "invalid_body");
  }
  if (!LEVELS.includes(input.level)) throw new WorkspaceError("Invalid permission level.", "invalid_body");
  if (agentId === workspace.agentId) {
    throw new WorkspaceError("The owning agent already has full access.", "invalid_body");
  }
  if (agentId && !(await db.agent.findUnique({ where: { id: agentId }, select: { id: true } }))) {
    throw new WorkspaceError("Grantee agent not found.", "invalid_body");
  }
  if (userId && !(await db.user.findUnique({ where: { id: userId }, select: { id: true } }))) {
    throw new WorkspaceError("Grantee user not found.", "invalid_body");
  }

  // The uniqueness tuple contains nullable columns, so a grant is looked up
  // explicitly rather than upserted through a partially-null compound key.
  const existing = await db.workspacePermission.findFirst({
    where: { agentWorkspaceId: workspace.id, granteeAgentId: agentId, granteeUserId: userId },
  });
  const payload = {
    level: input.level,
    grantedByUserId: actor.userId ?? null,
    reason: input.reason?.trim() || null,
    expiresAt: input.expiresAt ?? null,
    revokedAt: null,
  };
  const grant = existing
    ? await db.workspacePermission.update({ where: { id: existing.id }, data: payload })
    : await db.workspacePermission.create({
        data: { agentWorkspaceId: workspace.id, granteeAgentId: agentId, granteeUserId: userId, ...payload },
      });

  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "permission.changed",
    message: `Granted ${input.level} access to ${agentId ? `agent ${agentId}` : `user ${userId}`}.`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { grantId: grant.id, level: input.level, granteeAgentId: agentId, granteeUserId: userId, expiresAt: input.expiresAt },
  });
  return grant;
}

export async function revokePermission(workspace: AgentWorkspace, grantId: string, actor: ActorContext) {
  const grant = await db.workspacePermission.findFirst({ where: { id: grantId, agentWorkspaceId: workspace.id } });
  if (!grant) throw new WorkspaceError("Permission grant not found.", "workspace_not_found");
  const revoked = await db.workspacePermission.update({ where: { id: grant.id }, data: { revokedAt: new Date() } });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "permission.changed",
    severity: "warn",
    message: `Revoked access for ${grant.granteeAgentId ? `agent ${grant.granteeAgentId}` : `user ${grant.granteeUserId}`}.`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { grantId: grant.id },
  });
  return revoked;
}

export async function listPermissions(agentWorkspaceId: string) {
  return db.workspacePermission.findMany({ where: { agentWorkspaceId }, orderBy: { createdAt: "desc" } });
}

/** Move ownership to another agent. Recorded, never silent. */
export async function transferWorkspace(input: {
  workspace: AgentWorkspace;
  toAgentId: string;
  reason: string;
  keepPreviousAgentAccess: GrantLevel | null;
  actor: ActorContext;
}) {
  const { workspace, actor } = input;
  if (!input.reason.trim()) throw new WorkspaceError("A transfer reason is required.", "invalid_body");
  if (input.toAgentId === workspace.agentId) throw new WorkspaceError("The workspace already belongs to that agent.", "invalid_body");
  const target = await db.agent.findUnique({ where: { id: input.toAgentId }, select: { id: true } });
  if (!target) throw new WorkspaceError("Target agent not found.", "invalid_body");

  const previousAgentId = workspace.agentId;
  const updated = await db.agentWorkspace.update({ where: { id: workspace.id }, data: { agentId: input.toAgentId } });
  if (input.keepPreviousAgentAccess) {
    await grantPermission({
      workspace: updated,
      granteeAgentId: previousAgentId,
      level: input.keepPreviousAgentAccess,
      reason: `Retained after transfer: ${input.reason.trim()}`,
      actor,
    });
  }
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "workspace.transferred",
    severity: "warn",
    message: `Ownership transferred from ${previousAgentId} to ${input.toAgentId}.`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { previousAgentId, newAgentId: input.toAgentId, reason: input.reason.trim(), retainedAccess: input.keepPreviousAgentAccess },
  });
  return updated;
}

/**
 * Clone produces an independent workspace with a copy of the data volume. The
 * source is never mutated and the clone gets its own identity and runtime.
 */
export async function cloneWorkspace(input: {
  workspace: AgentWorkspace;
  targetAgentId: string;
  name: string;
  actor: ActorContext;
}) {
  const { workspace, actor } = input;
  if (!workspace.volumeName) throw new WorkspaceError("This workspace has no data volume to clone.", "volume_missing");

  const clone = await createAgentWorkspace({
    agentId: input.targetAgentId,
    tenantWorkspaceId: workspace.workspaceId,
    ownerUserId: actor.userId ?? workspace.ownerUserId,
    organizationId: workspace.organizationId,
    projectId: workspace.projectId,
    name: input.name,
    description: `Cloned from ${workspace.name}`,
    runtimeType: workspace.runtimeType,
    image: workspace.image,
    homePath: workspace.homePath,
    resourceLimits: workspace.resourceLimits as Prisma.JsonObject,
    policy: workspace.policy as Prisma.JsonObject,
    actor,
  });

  const provider = getRuntimeProvider(workspace.runtimeType);
  const snapshot = await provider.createSnapshot(workspace.id, workspace.volumeName, `clone-${clone.id}`);
  try {
    await provider.restoreSnapshot(clone.id, clone.volumeName!, snapshot.storageRef);
  } finally {
    await provider.deleteSnapshot(snapshot.storageRef).catch(() => undefined);
  }

  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "workspace.cloned",
    message: `Cloned into "${clone.name}" for agent ${input.targetAgentId}.`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { cloneWorkspaceId: clone.id, targetAgentId: input.targetAgentId },
  });
  return clone;
}

/** Runtime identity for a clone/transfer response. */
export async function runtimeSummary(agentWorkspaceId: string) {
  const runtime = await currentRuntime(agentWorkspaceId);
  return runtime ? { runtimeId: runtime.id, state: runtime.state } : { runtimeId: null, state: "STOPPED" as const };
}

export { specFor };
