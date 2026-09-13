import type { AgentWorkspace } from "@prisma/client";
import { db } from "@/lib/db";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { assertClientAllowed, assertDelegationAllowed, parsePolicy } from "./policy";
import { assertAgentMayAccess, loadWorkspaceOrThrow, type GrantLevel } from "./authorization";
import type { ActorContext } from "./service";
import type { RuntimeClient } from "./types";

/**
 * The Sentinel Runtime Gateway for agent workspaces.
 *
 * Agents — Hermes, Claude Code, Codex — never touch a container runtime. They
 * call in here with an explicit identity, and the gateway resolves
 * authorization, workspace ownership and orchestration policy before any
 * provider is reached.
 */
export interface GatewayRequest {
  agentWorkspaceId: string;
  /** The agent on whose behalf the work runs. */
  actingAgentId: string;
  /** Which execution client is asking. Never inferred. */
  client: RuntimeClient;
  requiredLevel: GrantLevel;
  /** Present only when a human explicitly authorised this specific handoff. */
  delegation?: {
    fromClient: RuntimeClient;
    authorizedByUserId: string;
    reason: string;
  } | null;
}

export interface GatewayGrant {
  workspace: AgentWorkspace;
  actor: ActorContext;
  accessVia: "owner" | "grant";
}

export async function authorizeAgentRequest(request: GatewayRequest): Promise<GatewayGrant> {
  const workspace = await loadWorkspaceOrThrow(request.agentWorkspaceId);
  const policy = parsePolicy(workspace.policy);

  assertClientAllowed(policy, request.client);

  if (workspace.status === "ARCHIVED" && request.requiredLevel !== "read") {
    throw new WorkspaceError("This workspace is archived and accepts read access only.", "workspace_archived");
  }
  if (workspace.locked && request.requiredLevel !== "read") {
    throw new WorkspaceError("This workspace is locked against mutation.", "workspace_locked");
  }

  const access = await assertAgentMayAccess(workspace, request.actingAgentId, request.requiredLevel);

  if (request.delegation && request.delegation.fromClient !== request.client) {
    // Claude Code and Codex are independent clients. A handoff between them is
    // only ever valid with an operator-supplied authorization on this request.
    assertDelegationAllowed({
      policy,
      fromClient: request.delegation.fromClient,
      toClient: request.client,
      explicitAuthorization: {
        authorizedByUserId: request.delegation.authorizedByUserId,
        reason: request.delegation.reason,
      },
    });
    await recordWorkspaceEvent({
      agentWorkspaceId: workspace.id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "delegation.authorized",
      severity: "warn",
      actorAgentId: request.actingAgentId,
      actorUserId: request.delegation.authorizedByUserId,
      source: request.client,
      message: `Explicitly authorized handoff ${request.delegation.fromClient} -> ${request.client}.`,
      metadata: { reason: request.delegation.reason },
    });
  }

  return {
    workspace,
    actor: { userId: null, agentId: request.actingAgentId, client: request.client },
    accessVia: access.via,
  };
}

/**
 * Reject an implicit cross-client handoff. Called by orchestration code before
 * routing work from one execution client to another.
 */
export async function assertClientHandoffAllowed(input: {
  agentWorkspaceId: string;
  fromClient: RuntimeClient;
  toClient: RuntimeClient;
  authorization?: { authorizedByUserId: string; reason: string } | null;
  actingAgentId?: string | null;
}) {
  const workspace = await loadWorkspaceOrThrow(input.agentWorkspaceId);
  const policy = parsePolicy(workspace.policy);
  try {
    assertDelegationAllowed({
      policy,
      fromClient: input.fromClient,
      toClient: input.toClient,
      explicitAuthorization: input.authorization ?? null,
    });
  } catch (error) {
    await recordWorkspaceEvent({
      agentWorkspaceId: workspace.id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "delegation.blocked",
      severity: "warn",
      actorAgentId: input.actingAgentId ?? null,
      source: input.fromClient,
      message: `Blocked implicit handoff ${input.fromClient} -> ${input.toClient}.`,
      metadata: { policy: policy.crossAgentDelegation },
    });
    throw error;
  }
  return { allowed: true as const, policy: policy.crossAgentDelegation };
}

/** Workspaces an execution client may currently act in, for one agent. */
export async function listAgentWorkspacesForAgent(agentId: string) {
  const owned = await db.agentWorkspace.findMany({
    where: { agentId, status: { not: "DELETED" } },
    orderBy: { createdAt: "desc" },
  });
  const granted = await db.workspacePermission.findMany({
    where: { granteeAgentId: agentId, revokedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] },
    include: { agentWorkspace: true },
  });
  return {
    owned,
    shared: granted
      .filter((grant) => grant.agentWorkspace.status !== "DELETED")
      .map((grant) => ({ workspace: grant.agentWorkspace, level: grant.level as GrantLevel })),
  };
}
