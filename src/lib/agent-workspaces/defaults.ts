import { Prisma, type AgentWorkspace } from "@prisma/client";
import { db } from "@/lib/db";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { DEFAULT_LIMITS, DEFAULT_POLICY, parseLimits, parsePolicy } from "./policy";
import { getRuntimeProvider } from "./providers";
import { slugify, type ActorContext } from "./service";

/**
 * The only resolver for an agent's persistent computer. It deliberately has
 * no ordering fallback: zero and multiple legacy candidates are different,
 * actionable states.
 */
export interface DefaultWorkspaceProvisioning {
  tenantWorkspaceId: string;
  ownerUserId: string;
  organizationId?: string | null;
  projectId?: string | null;
  name?: string;
  description?: string;
  runtimeType?: string;
  image?: string;
  homePath?: string;
  resourceLimits?: Partial<typeof DEFAULT_LIMITS>;
  policy?: Partial<typeof DEFAULT_POLICY>;
  actor: ActorContext;
}

export interface ResolveDefaultAgentWorkspaceInput {
  agentId: string;
  /** Required only when no existing workspace can be safely promoted. */
  provisioning?: DefaultWorkspaceProvisioning;
}

type Resolution = { workspace: AgentWorkspace; assigned: boolean; created: boolean };

async function withAgentDefaultLock<T>(agentId: string, work: (tx: Prisma.TransactionClient) => Promise<T>) {
  return db.$transaction(async (tx) => {
    // Serializes default resolution/switches per agent even before the partial
    // unique index gets a chance to reject a concurrent writer.
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${agentId}))`;
    return work(tx);
  }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
}

async function uniqueSlug(tx: Prisma.TransactionClient, workspaceId: string, name: string) {
  const base = slugify(name);
  let slug = base;
  for (let attempt = 1; await tx.agentWorkspace.findFirst({ where: { workspaceId, slug }, select: { id: true } }); attempt += 1) {
    slug = `${base}-${attempt}`;
  }
  return slug;
}

function creationData(agentId: string, input: DefaultWorkspaceProvisioning, slug: string): Prisma.AgentWorkspaceUncheckedCreateInput {
  const name = (input.name?.trim() || `${agentId} Persistent Computer`).slice(0, 120);
  return {
    agentId,
    ownerUserId: input.ownerUserId,
    workspaceId: input.tenantWorkspaceId,
    organizationId: input.organizationId ?? null,
    projectId: input.projectId ?? null,
    name,
    slug,
    description: input.description?.trim() || null,
    runtimeType: input.runtimeType?.trim() || "docker",
    image: input.image?.trim() || process.env.AGENT_WORKSPACE_IMAGE || "sentinel/agent-workspace:base",
    homePath: input.homePath?.trim() || "/workspace",
    resourceLimits: parseLimits(input.resourceLimits) as unknown as Prisma.InputJsonValue,
    policy: parsePolicy(input.policy) as unknown as Prisma.InputJsonValue,
    isDefault: true,
  };
}

function conflict(agentId: string, candidates: AgentWorkspace[]) {
  return new WorkspaceError(
    `Agent ${agentId} has ${candidates.length} non-deleted workspaces and no canonical default. Assign one explicitly; Sentinel will not guess.`,
    "default_workspace_conflict",
    candidates.map((workspace) => workspace.id).join(","),
  );
}

/** Resolve, safely promote the sole legacy candidate, or provision a new default. */
export async function resolveDefaultAgentWorkspace(input: ResolveDefaultAgentWorkspaceInput): Promise<AgentWorkspace> {
  const agentId = input.agentId.trim();
  if (!agentId) throw new WorkspaceError("agentId is required.", "invalid_body");

  const result = await withAgentDefaultLock(agentId, async (tx): Promise<Resolution> => {
    const defaults = await tx.agentWorkspace.findMany({ where: { agentId, isDefault: true }, orderBy: { id: "asc" } });
    if (defaults.length === 1) return { workspace: defaults[0], assigned: false, created: false };
    if (defaults.length > 1) throw conflict(agentId, defaults);

    const candidates = await tx.agentWorkspace.findMany({ where: { agentId, status: { not: "DELETED" } }, orderBy: { id: "asc" } });
    if (candidates.length === 1) {
      const workspace = await tx.agentWorkspace.update({ where: { id: candidates[0].id }, data: { isDefault: true } });
      return { workspace, assigned: true, created: false };
    }
    if (candidates.length > 1) throw conflict(agentId, candidates);
    if (!input.provisioning) {
      throw new WorkspaceError(
        `Agent ${agentId} has no persistent computer. Provide explicit provisioning details to create its default workspace.`,
        "default_workspace_missing",
      );
    }

    const agent = await tx.agent.findUnique({ where: { id: agentId }, select: { id: true } });
    if (!agent) throw new WorkspaceError("Agent not found.", "invalid_body");
    const name = (input.provisioning.name?.trim() || `${agentId} Persistent Computer`).slice(0, 120);
    const slug = await uniqueSlug(tx, input.provisioning.tenantWorkspaceId, name);
    const workspace = await tx.agentWorkspace.create({ data: creationData(agentId, input.provisioning, slug) });
    return { workspace, assigned: false, created: true };
  });

  if (result.created) {
    const provisioning = input.provisioning!;
    const provider = getRuntimeProvider(result.workspace.runtimeType);
    const availability = await provider.isAvailable();
    if (!availability.available) {
      throw new WorkspaceError("The workspace runtime backend is unavailable on this host.", "runtime_unavailable", availability.reason);
    }
    const { volumeName } = await provider.createWorkspace({
      workspaceId: result.workspace.id,
      agentId: result.workspace.agentId,
      image: result.workspace.image,
      homePath: result.workspace.homePath,
      limits: parseLimits(result.workspace.resourceLimits),
    });
    result.workspace = await db.agentWorkspace.update({ where: { id: result.workspace.id }, data: { volumeName } });
    await recordWorkspaceEvent({
      agentWorkspaceId: result.workspace.id,
      tenantWorkspaceId: result.workspace.workspaceId,
      type: "workspace.created",
      message: `Default workspace \"${result.workspace.name}\" created for agent ${agentId}.`,
      actorUserId: provisioning.actor.userId ?? null,
      actorAgentId: provisioning.actor.agentId ?? null,
      source: provisioning.actor.client,
      metadata: { volumeName, default: true, runtimeType: result.workspace.runtimeType, image: result.workspace.image },
    });
  } else if (result.assigned) {
    await recordWorkspaceEvent({
      agentWorkspaceId: result.workspace.id,
      tenantWorkspaceId: result.workspace.workspaceId,
      type: "workspace.default_assigned",
      message: `Workspace assigned as the canonical persistent computer for agent ${agentId}.`,
      source: "system",
      metadata: { default: true },
    });
  }
  return result.workspace;
}

/** Explicit, transactional default change. The old default is cleared first. */
export async function setDefaultAgentWorkspace(input: { agentId: string; agentWorkspaceId: string; actor: ActorContext }) {
  const agentId = input.agentId.trim();
  const workspace = await withAgentDefaultLock(agentId, async (tx) => {
    const target = await tx.agentWorkspace.findUnique({ where: { id: input.agentWorkspaceId } });
    if (!target || target.status === "DELETED") throw new WorkspaceError("Workspace not found.", "workspace_not_found");
    if (target.agentId !== agentId) throw new WorkspaceError("A workspace can only be made default for its owning agent.", "workspace_forbidden");
    await tx.agentWorkspace.updateMany({ where: { agentId, isDefault: true, NOT: { id: target.id } }, data: { isDefault: false } });
    return tx.agentWorkspace.update({ where: { id: target.id }, data: { isDefault: true } });
  });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "workspace.default_assigned",
    severity: "warn",
    message: `Workspace explicitly assigned as the canonical persistent computer for agent ${agentId}.`,
    actorUserId: input.actor.userId ?? null,
    actorAgentId: input.actor.agentId ?? null,
    source: input.actor.client,
    metadata: { default: true, explicit: true },
  });
  return workspace;
}
