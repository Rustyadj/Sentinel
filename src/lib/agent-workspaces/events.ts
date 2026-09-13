import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import type { RuntimeClient } from "./types";

export type WorkspaceEventType =
  | "workspace.created" | "workspace.started" | "workspace.stopped" | "workspace.paused"
  | "workspace.resumed" | "workspace.restarted" | "workspace.archived" | "workspace.unarchived"
  | "workspace.locked" | "workspace.unlocked" | "workspace.cloned" | "workspace.transferred"
  | "workspace.limits_changed" | "workspace.data_deleted"
  | "runtime.destroyed" | "runtime.error" | "runtime.reconciled" | "runtime.idle_paused"
  | "command.executed" | "process.started" | "process.stopped"
  | "file.modified" | "file.deleted" | "file.moved" | "file.copied"
  | "repo.cloned" | "git.command"
  | "snapshot.created" | "snapshot.restored" | "snapshot.deleted"
  | "permission.changed" | "artifact.created" | "artifact.deleted"
  | "delegation.blocked" | "delegation.authorized";

export interface WorkspaceEventInput {
  agentWorkspaceId: string;
  type: WorkspaceEventType;
  message: string;
  severity?: "info" | "warn" | "error";
  actorUserId?: string | null;
  actorAgentId?: string | null;
  source?: RuntimeClient;
  metadata?: Record<string, unknown>;
  /** Tenant workspace, so the event also lands in the global audit trail. */
  tenantWorkspaceId?: string | null;
}

/**
 * One append-only trail per agent workspace, mirrored into Sentinel's existing
 * AuditLog so workspace activity shows up alongside every other audited action.
 */
export async function recordWorkspaceEvent(input: WorkspaceEventInput) {
  const event = await db.workspaceEvent.create({
    data: {
      agentWorkspaceId: input.agentWorkspaceId,
      type: input.type,
      severity: input.severity ?? "info",
      actorUserId: input.actorUserId ?? null,
      actorAgentId: input.actorAgentId ?? null,
      source: input.source ?? "system",
      message: input.message,
      metadata: (input.metadata ?? {}) as Prisma.InputJsonValue,
    },
  });
  await writeAuditLog({
    workspaceId: input.tenantWorkspaceId ?? null,
    userId: input.actorUserId ?? null,
    agentId: input.actorAgentId ?? null,
    action: `agent_workspace.${input.type}`,
    entityType: "AgentWorkspace",
    entityId: input.agentWorkspaceId,
    details: { ...(input.metadata ?? {}), message: input.message, source: input.source ?? "system" },
  }).catch(() => undefined);
  return event;
}

export async function listWorkspaceEvents(agentWorkspaceId: string, limit = 100) {
  return db.workspaceEvent.findMany({
    where: { agentWorkspaceId },
    orderBy: { occurredAt: "desc" },
    take: Math.min(Math.max(limit, 1), 500),
  });
}
