// Server-side only. The `server-only` marker package is deliberately not used:
// it is unresolvable outside the Next bundler, which breaks the Node entry
// points that legitimately drive workspaces (the acceptance script, cron and
// worker processes). These modules import Node built-ins, so a client import
// fails loudly on its own.
import { db } from "@/lib/db";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { parseLimits } from "./policy";

const lockTails = new Map<string, Promise<void>>();

export interface WorkspaceDiskQuota {
  limitBytes: number;
  homePath: string;
}

export async function loadWorkspaceDiskQuota(workspaceId: string): Promise<WorkspaceDiskQuota> {
  const workspace = await db.agentWorkspace.findUnique({
    where: { id: workspaceId },
    select: { resourceLimits: true, homePath: true },
  });
  if (!workspace) throw new WorkspaceError("Workspace not found.", "workspace_not_found");
  const limits = parseLimits(workspace.resourceLimits);
  return { limitBytes: Math.floor(limits.diskGb * 1024 ** 3), homePath: workspace.homePath };
}

/** Serialises provider mutations in this server process so two checked writes cannot both reserve the same free bytes. */
export async function withWorkspaceDiskLock<T>(workspaceId: string, operation: () => Promise<T>): Promise<T> {
  const previous = lockTails.get(workspaceId) ?? Promise.resolve();
  let release: () => void = () => undefined;
  const current = new Promise<void>((resolve) => { release = resolve; });
  const tail = previous.then(() => current);
  lockTails.set(workspaceId, tail);
  await previous;
  try {
    return await operation();
  } finally {
    release();
    if (lockTails.get(workspaceId) === tail) lockTails.delete(workspaceId);
  }
}

export async function throwDiskFull(input: {
  workspaceId: string;
  operation: string;
  usedBytes: number;
  limitBytes: number;
  projectedBytes?: number;
}): Promise<never> {
  const workspace = await db.agentWorkspace.findUnique({
    where: { id: input.workspaceId },
    select: { workspaceId: true, agentId: true },
  });
  await recordWorkspaceEvent({
    agentWorkspaceId: input.workspaceId,
    tenantWorkspaceId: workspace?.workspaceId ?? null,
    type: "runtime.error",
    severity: "warn",
    actorAgentId: workspace?.agentId ?? null,
    source: "system",
    message: `Disk quota blocked ${input.operation}.`,
    metadata: {
      code: "disk_full",
      operation: input.operation,
      usedBytes: input.usedBytes,
      projectedBytes: input.projectedBytes ?? input.usedBytes,
      limitBytes: input.limitBytes,
      enforcement: "checked-guard",
    },
  }).catch(() => undefined);
  throw new WorkspaceError(
    "The workspace disk limit has been reached. Delete files or increase the disk limit before writing more data.",
    "disk_full",
  );
}

export async function assertProjectedDiskUsage(input: {
  workspaceId: string;
  operation: string;
  usedBytes: number;
  limitBytes: number;
  addedBytes?: number;
}) {
  const projectedBytes = input.usedBytes + Math.max(0, input.addedBytes ?? 0);
  if (projectedBytes > input.limitBytes) {
    await throwDiskFull({ ...input, projectedBytes });
  }
}
