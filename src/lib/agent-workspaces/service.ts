import type { AgentWorkspace, AgentWorkspaceRuntime, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { DEFAULT_LIMITS, DEFAULT_POLICY, parseLimits, parsePolicy } from "./policy";
import { getRuntimeProvider } from "./providers";
import type {
  CreateWorkspaceSpec, RuntimeClient, RuntimeDescriptor, RuntimeState, RuntimeStats,
  WorkspaceDisplayState, WorkspaceIdentity,
} from "./types";

const DEFAULT_IMAGE = process.env.AGENT_WORKSPACE_IMAGE || "sentinel/agent-workspace:base";

export interface ActorContext {
  userId?: string | null;
  agentId?: string | null;
  client: RuntimeClient;
}

export function workspaceIdentity(workspace: AgentWorkspace, runtime: AgentWorkspaceRuntime | null): WorkspaceIdentity {
  return {
    workspaceId: workspace.id,
    agentId: workspace.agentId,
    runtimeId: runtime?.id ?? null,
    ownerId: workspace.ownerUserId,
    organizationId: workspace.organizationId,
    tenantWorkspaceId: workspace.workspaceId,
  };
}

export function specFor(workspace: AgentWorkspace): CreateWorkspaceSpec {
  return {
    workspaceId: workspace.id,
    agentId: workspace.agentId,
    image: workspace.image,
    homePath: workspace.homePath,
    limits: parseLimits(workspace.resourceLimits),
  };
}

export async function currentRuntime(agentWorkspaceId: string) {
  return db.agentWorkspaceRuntime.findFirst({
    where: { agentWorkspaceId, destroyedAt: null },
    orderBy: { createdAt: "desc" },
  });
}

export function slugify(value: string) {
  return value.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60) || "workspace";
}

export interface CreateAgentWorkspaceInput {
  agentId: string;
  tenantWorkspaceId: string;
  ownerUserId: string;
  organizationId?: string | null;
  projectId?: string | null;
  name: string;
  description?: string;
  runtimeType?: string;
  image?: string;
  homePath?: string;
  resourceLimits?: Partial<typeof DEFAULT_LIMITS>;
  policy?: Partial<typeof DEFAULT_POLICY>;
  actor: ActorContext;
}

/**
 * Provision workspace *data* only. Compute is started separately and on
 * purpose, so creating a workspace never silently burns resources.
 */
export async function createAgentWorkspace(input: CreateAgentWorkspaceInput) {
  const name = input.name.trim();
  if (!name || name.length > 120) throw new WorkspaceError("Workspace name is required (max 120 characters).", "invalid_body");

  const agent = await db.agent.findUnique({ where: { id: input.agentId }, select: { id: true } });
  if (!agent) throw new WorkspaceError("Agent not found.", "invalid_body");

  const runtimeType = input.runtimeType ?? "docker";
  const provider = getRuntimeProvider(runtimeType);
  const availability = await provider.isAvailable();
  if (!availability.available) {
    throw new WorkspaceError("The workspace runtime backend is unavailable on this host.", "runtime_unavailable", availability.reason);
  }

  const base = slugify(name);
  let slug = base;
  for (let attempt = 1; await db.agentWorkspace.findFirst({ where: { workspaceId: input.tenantWorkspaceId, slug } }); attempt += 1) {
    slug = `${base}-${attempt}`;
  }

  const created = await db.agentWorkspace.create({
    data: {
      agentId: input.agentId,
      ownerUserId: input.ownerUserId,
      workspaceId: input.tenantWorkspaceId,
      organizationId: input.organizationId ?? null,
      projectId: input.projectId ?? null,
      name,
      slug,
      description: input.description?.trim() || null,
      runtimeType,
      image: input.image?.trim() || DEFAULT_IMAGE,
      homePath: input.homePath?.trim() || "/workspace",
      resourceLimits: parseLimits(input.resourceLimits) as unknown as Prisma.InputJsonValue,
      policy: parsePolicy(input.policy) as unknown as Prisma.InputJsonValue,
      // Creating an additional/special-purpose workspace is never an implicit
      // default selection. Only defaults.ts may set this flag.
      isDefault: false,
    },
  });

  const { volumeName } = await provider.createWorkspace(specFor(created));
  const workspace = await db.agentWorkspace.update({ where: { id: created.id }, data: { volumeName } });

  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "workspace.created",
    message: `Workspace "${workspace.name}" created for agent ${workspace.agentId}.`,
    actorUserId: input.actor.userId ?? null,
    actorAgentId: input.actor.agentId ?? null,
    source: input.actor.client,
    metadata: { volumeName, runtimeType, image: workspace.image },
  });
  return workspace;
}

async function persistRuntimeState(
  workspace: AgentWorkspace,
  descriptor: RuntimeDescriptor | null,
  existing: AgentWorkspaceRuntime | null,
) {
  if (!descriptor) {
    if (!existing) return null;
    // The container is gone from the backend. Say so instead of reporting the
    // last value we happened to write.
    return db.agentWorkspaceRuntime.update({
      where: { id: existing.id },
      data: { state: "STOPPED", containerId: null, reconciledAt: new Date(), lastSeenAt: new Date(), errorCode: null, errorMessage: null },
    });
  }
  const data = {
    state: descriptor.state,
    containerId: descriptor.containerId ?? null,
    containerName: descriptor.containerName ?? null,
    image: descriptor.image || workspace.image,
    startedAt: descriptor.startedAt ? new Date(descriptor.startedAt) : existing?.startedAt ?? null,
    lastSeenAt: new Date(),
    reconciledAt: new Date(),
    errorCode: descriptor.errorCode ?? null,
    errorMessage: descriptor.errorMessage ?? null,
    ...(descriptor.state === "STOPPED" && existing?.state === "RUNNING" ? { stoppedAt: new Date() } : {}),
  };
  if (existing) return db.agentWorkspaceRuntime.update({ where: { id: existing.id }, data });
  return db.agentWorkspaceRuntime.create({
    data: { agentWorkspaceId: workspace.id, provider: workspace.runtimeType, ...data },
  });
}

/**
 * Ask the backend what is actually true and write that down. Sentinel never
 * reports a runtime state that came only from the database.
 */
export async function reconcileRuntime(workspace: AgentWorkspace) {
  const provider = getRuntimeProvider(workspace.runtimeType);
  const existing = await currentRuntime(workspace.id);
  let descriptor: RuntimeDescriptor | null = null;
  try {
    descriptor = await provider.getStatus(workspace.id);
  } catch (error) {
    const message = error instanceof WorkspaceError ? error.message : "Runtime status could not be determined.";
    if (existing) {
      return db.agentWorkspaceRuntime.update({
        where: { id: existing.id },
        data: { state: "ERROR", errorCode: error instanceof WorkspaceError ? error.code : "unknown", errorMessage: message, reconciledAt: new Date() },
      });
    }
    throw error;
  }
  const runtime = await persistRuntimeState(workspace, descriptor, existing);
  if (existing && runtime && existing.state !== runtime.state) {
    await recordWorkspaceEvent({
      agentWorkspaceId: workspace.id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "runtime.reconciled",
      severity: runtime.state === "ERROR" ? "error" : "info",
      message: `Runtime state reconciled from ${existing.state} to ${runtime.state}.`,
      metadata: { previous: existing.state, current: runtime.state },
    });
  }
  return runtime;
}

export function displayState(workspace: AgentWorkspace, runtime: AgentWorkspaceRuntime | null): WorkspaceDisplayState {
  if (workspace.status === "ARCHIVED") return "ARCHIVED";
  return (runtime?.state as RuntimeState) ?? "STOPPED";
}

async function markRuntime(agentWorkspaceId: string, state: RuntimeState, patch: Partial<Prisma.AgentWorkspaceRuntimeUncheckedUpdateInput> = {}) {
  const runtime = await currentRuntime(agentWorkspaceId);
  if (!runtime) return null;
  return db.agentWorkspaceRuntime.update({ where: { id: runtime.id }, data: { state, ...patch } });
}

export async function startRuntime(workspace: AgentWorkspace, actor: ActorContext) {
  if (workspace.status === "ARCHIVED") throw new WorkspaceError("Archived workspaces cannot be started.", "workspace_archived");
  const provider = getRuntimeProvider(workspace.runtimeType);
  const volumeName = workspace.volumeName ?? (await provider.createWorkspace(specFor(workspace))).volumeName;
  if (!workspace.volumeName) {
    await db.agentWorkspace.update({ where: { id: workspace.id }, data: { volumeName } });
  }

  const existing = await currentRuntime(workspace.id);
  if (existing) await db.agentWorkspaceRuntime.update({ where: { id: existing.id }, data: { state: "STARTING", errorCode: null, errorMessage: null } });

  try {
    const descriptor = await provider.startWorkspace({ ...specFor(workspace), volumeName });
    const runtime = await persistRuntimeState(workspace, descriptor, existing);
    await db.agentWorkspace.update({ where: { id: workspace.id }, data: { lastActiveAt: new Date() } });
    await recordWorkspaceEvent({
      agentWorkspaceId: workspace.id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "workspace.started",
      message: `Runtime started (${descriptor.state}).`,
      actorUserId: actor.userId ?? null,
      actorAgentId: actor.agentId ?? null,
      source: actor.client,
      metadata: { containerId: descriptor.containerId, image: descriptor.image },
    });
    return runtime;
  } catch (error) {
    const detail = error instanceof WorkspaceError ? { code: error.code, message: error.message, detail: error.detail } : { code: "unknown" };
    await markRuntime(workspace.id, "ERROR", { errorCode: String(detail.code), errorMessage: detail.message ?? "Runtime start failed" });
    await recordWorkspaceEvent({
      agentWorkspaceId: workspace.id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "runtime.error",
      severity: "error",
      message: "Runtime failed to start.",
      actorUserId: actor.userId ?? null,
      source: actor.client,
      metadata: detail,
    });
    throw error;
  }
}

export async function stopRuntime(workspace: AgentWorkspace, actor: ActorContext) {
  const provider = getRuntimeProvider(workspace.runtimeType);
  await markRuntime(workspace.id, "STOPPING");
  const descriptor = await provider.stopWorkspace(workspace.id);
  const runtime = await persistRuntimeState(workspace, descriptor, await currentRuntime(workspace.id));
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "workspace.stopped",
    message: "Runtime stopped. Workspace data is retained.",
    actorUserId: actor.userId ?? null,
    source: actor.client,
  });
  return runtime;
}

export async function pauseRuntime(workspace: AgentWorkspace, actor: ActorContext, reason = "manual") {
  const provider = getRuntimeProvider(workspace.runtimeType);
  const descriptor = await provider.pauseWorkspace(workspace.id);
  const runtime = await persistRuntimeState(workspace, descriptor, await currentRuntime(workspace.id));
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: reason === "idle" ? "runtime.idle_paused" : "workspace.paused",
    message: reason === "idle" ? "Runtime paused after idle timeout." : "Runtime paused.",
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { reason },
  });
  return runtime;
}

export async function resumeRuntime(workspace: AgentWorkspace, actor: ActorContext) {
  const provider = getRuntimeProvider(workspace.runtimeType);
  const observed = await provider.getStatus(workspace.id);
  const descriptor = observed?.state === "PAUSED"
    ? await provider.resumeWorkspace(workspace.id)
    : await provider.startWorkspace({ ...specFor(workspace), volumeName: workspace.volumeName ?? (await provider.createWorkspace(specFor(workspace))).volumeName });
  const runtime = await persistRuntimeState(workspace, descriptor, await currentRuntime(workspace.id));
  await db.agentWorkspace.update({ where: { id: workspace.id }, data: { lastActiveAt: new Date() } });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "workspace.resumed",
    message: "Runtime resumed.",
    actorUserId: actor.userId ?? null,
    source: actor.client,
  });
  return runtime;
}

export async function restartRuntime(workspace: AgentWorkspace, actor: ActorContext) {
  const provider = getRuntimeProvider(workspace.runtimeType);
  const volumeName = workspace.volumeName ?? (await provider.createWorkspace(specFor(workspace))).volumeName;
  const descriptor = await provider.restartWorkspace({ ...specFor(workspace), volumeName });
  const runtime = await persistRuntimeState(workspace, descriptor, await currentRuntime(workspace.id));
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "workspace.restarted",
    message: "Runtime restarted.",
    actorUserId: actor.userId ?? null,
    source: actor.client,
  });
  return runtime;
}

/** Compute teardown. Workspace data survives; this is not a delete. */
export async function destroyRuntime(workspace: AgentWorkspace, actor: ActorContext) {
  const provider = getRuntimeProvider(workspace.runtimeType);
  await provider.destroyRuntime(workspace.id);
  const runtime = await currentRuntime(workspace.id);
  if (runtime) {
    await db.agentWorkspaceRuntime.update({
      where: { id: runtime.id },
      data: { state: "STOPPED", destroyedAt: new Date(), containerId: null, stoppedAt: new Date() },
    });
  }
  await db.workspaceProcess.updateMany({
    where: { agentWorkspaceId: workspace.id, status: "running" },
    data: { status: "unknown", stoppedAt: new Date() },
  });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "runtime.destroyed",
    message: "Runtime container destroyed. Workspace data was not touched.",
    actorUserId: actor.userId ?? null,
    source: actor.client,
  });
}

/** Separately authorised, irreversible destruction of the data volume. */
export async function deleteWorkspaceData(workspace: AgentWorkspace, actor: ActorContext) {
  if (workspace.isDefault) {
    throw new WorkspaceError("The canonical persistent computer cannot be deleted. Assign another workspace as default first.", "policy_violation");
  }
  const provider = getRuntimeProvider(workspace.runtimeType);
  await provider.destroyRuntime(workspace.id).catch(() => undefined);
  if (workspace.volumeName) await provider.destroyWorkspaceData(workspace.volumeName);
  const snapshots = await db.workspaceSnapshot.findMany({ where: { agentWorkspaceId: workspace.id, status: "ready" } });
  for (const snapshot of snapshots) {
    if (snapshot.storageRef) await provider.deleteSnapshot(snapshot.storageRef).catch(() => undefined);
  }
  await db.$transaction([
    db.workspaceSnapshot.updateMany({ where: { agentWorkspaceId: workspace.id }, data: { status: "deleted" } }),
    db.agentWorkspaceRuntime.updateMany({ where: { agentWorkspaceId: workspace.id, destroyedAt: null }, data: { destroyedAt: new Date(), state: "STOPPED" } }),
    db.agentWorkspace.update({ where: { id: workspace.id }, data: { status: "DELETED", dataDeletedAt: new Date(), volumeName: null } }),
  ]);
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "workspace.data_deleted",
    severity: "warn",
    message: "Workspace data volume and snapshots were permanently deleted.",
    actorUserId: actor.userId ?? null,
    source: actor.client,
  });
}

export async function setArchived(workspace: AgentWorkspace, archived: boolean, actor: ActorContext) {
  if (archived) {
    await getRuntimeProvider(workspace.runtimeType).destroyRuntime(workspace.id).catch(() => undefined);
    await db.agentWorkspaceRuntime.updateMany({
      where: { agentWorkspaceId: workspace.id, destroyedAt: null },
      data: { state: "STOPPED", destroyedAt: new Date() },
    });
  }
  const updated = await db.agentWorkspace.update({
    where: { id: workspace.id },
    data: { status: archived ? "ARCHIVED" : "ACTIVE", archivedAt: archived ? new Date() : null },
  });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: archived ? "workspace.archived" : "workspace.unarchived",
    message: archived ? "Workspace archived; compute released, data retained." : "Workspace unarchived.",
    actorUserId: actor.userId ?? null,
    source: actor.client,
  });
  return updated;
}

export async function setLocked(workspace: AgentWorkspace, locked: boolean, actor: ActorContext) {
  const updated = await db.agentWorkspace.update({ where: { id: workspace.id }, data: { locked } });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: locked ? "workspace.locked" : "workspace.unlocked",
    message: locked ? "Workspace locked against mutation." : "Workspace unlocked.",
    actorUserId: actor.userId ?? null,
    source: actor.client,
  });
  return updated;
}

export async function updateLimits(workspace: AgentWorkspace, limits: unknown, actor: ActorContext) {
  const parsed = parseLimits(limits);
  const updated = await db.agentWorkspace.update({
    where: { id: workspace.id },
    data: { resourceLimits: parsed as unknown as Prisma.InputJsonValue },
  });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "workspace.limits_changed",
    message: "Resource policy updated. Restart the runtime to apply it.",
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { limits: parsed },
  });
  return updated;
}

export async function getStats(workspace: AgentWorkspace): Promise<RuntimeStats> {
  return getRuntimeProvider(workspace.runtimeType).getStats(workspace.id);
}

/** Guard for anything that must touch a live runtime. */
export async function requireRunningRuntime(workspace: AgentWorkspace) {
  const runtime = await reconcileRuntime(workspace);
  if (!runtime || runtime.state !== "RUNNING") {
    throw new WorkspaceError(
      `The workspace runtime is ${(runtime?.state ?? "STOPPED").toLowerCase()}. Start it first.`,
      "runtime_not_running",
    );
  }
  return runtime;
}
