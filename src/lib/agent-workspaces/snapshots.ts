import type { AgentWorkspace } from "@prisma/client";
import { db } from "@/lib/db";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { getRuntimeProvider } from "./providers";
import { gitSummary } from "./git";
import { runCommand } from "./exec";
import { currentRuntime, type ActorContext } from "./service";

async function fileState(workspace: AgentWorkspace, actor: ActorContext) {
  const runtime = await currentRuntime(workspace.id);
  if (!runtime || runtime.state !== "RUNNING") return {};
  try {
    const result = await runCommand({
      workspace,
      command: 'find . -type f -not -path "./.git/*" | wc -l; du -sb . | cut -f1',
      actor,
      metadata: { via: "snapshot.filestate" },
    });
    const [fileCount, bytes] = result.stdout.trim().split("\n");
    return { fileCount: Number.parseInt(fileCount, 10) || 0, totalBytes: Number.parseInt(bytes, 10) || 0 };
  } catch {
    return {};
  }
}

/**
 * Snapshot the data volume. Compute may keep running; the tar is taken through
 * a separate read-only mount, so a snapshot never depends on the workspace
 * runtime being healthy.
 */
export async function createSnapshot(input: {
  workspace: AgentWorkspace;
  name: string;
  reason: string;
  actor: ActorContext;
}) {
  const { workspace, actor } = input;
  if (!workspace.volumeName) throw new WorkspaceError("This workspace has no data volume to snapshot.", "volume_missing");
  if (!input.reason.trim()) throw new WorkspaceError("A snapshot reason is required.", "invalid_body");

  const snapshot = await db.workspaceSnapshot.create({
    data: {
      agentWorkspaceId: workspace.id,
      agentId: workspace.agentId,
      createdByUserId: actor.userId ?? null,
      name: input.name.trim() || `snapshot-${new Date().toISOString()}`,
      reason: input.reason.trim(),
      status: "creating",
      gitState: (await gitSummary(workspace, undefined, actor)) ?? {},
      fileState: await fileState(workspace, actor),
      runtimeMetadata: { image: workspace.image, runtimeType: workspace.runtimeType, volumeName: workspace.volumeName },
    },
  });

  try {
    const ref = await getRuntimeProvider(workspace.runtimeType).createSnapshot(workspace.id, workspace.volumeName, snapshot.id);
    const ready = await db.workspaceSnapshot.update({
      where: { id: snapshot.id },
      data: { status: "ready", storageRef: ref.storageRef, sizeBytes: BigInt(ref.sizeBytes), completedAt: new Date() },
    });
    await recordWorkspaceEvent({
      agentWorkspaceId: workspace.id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "snapshot.created",
      message: `Snapshot "${ready.name}" created (${input.reason.trim()}).`,
      actorUserId: actor.userId ?? null,
      source: actor.client,
      metadata: { snapshotId: ready.id, sizeBytes: ref.sizeBytes },
    });
    return ready;
  } catch (error) {
    const message = error instanceof WorkspaceError ? error.message : "Snapshot failed.";
    await db.workspaceSnapshot.update({ where: { id: snapshot.id }, data: { status: "failed", errorMessage: message } });
    throw error;
  }
}

/**
 * Restore is never automatic: the caller must name the snapshot and confirm.
 * The runtime is stopped first so nothing writes underneath the restore.
 */
export async function restoreSnapshot(input: {
  workspace: AgentWorkspace;
  snapshotId: string;
  confirm: boolean;
  actor: ActorContext;
}) {
  const { workspace, actor } = input;
  if (!input.confirm) {
    throw new WorkspaceError("Snapshot restore requires explicit confirmation.", "policy_violation");
  }
  const snapshot = await db.workspaceSnapshot.findFirst({ where: { id: input.snapshotId, agentWorkspaceId: workspace.id } });
  if (!snapshot || snapshot.status !== "ready" || !snapshot.storageRef) {
    throw new WorkspaceError("Snapshot not found or not restorable.", "snapshot_not_found");
  }
  if (!workspace.volumeName) throw new WorkspaceError("This workspace has no data volume.", "volume_missing");

  const provider = getRuntimeProvider(workspace.runtimeType);
  const runtimeWasRunning = (await currentRuntime(workspace.id))?.state === "RUNNING";
  if (runtimeWasRunning) {
    await provider.stopWorkspace(workspace.id).catch(() => undefined);
    await db.agentWorkspaceRuntime.updateMany({
      where: { agentWorkspaceId: workspace.id, destroyedAt: null },
      data: { state: "STOPPED", stoppedAt: new Date() },
    });
  }

  await provider.restoreSnapshot(workspace.id, workspace.volumeName, snapshot.storageRef);
  await db.workspaceSnapshot.update({ where: { id: snapshot.id }, data: { restoredAt: new Date() } });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "snapshot.restored",
    severity: "warn",
    message: `Snapshot "${snapshot.name}" restored over workspace data.`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { snapshotId: snapshot.id, runtimeWasRunning },
  });
  return { snapshotId: snapshot.id, runtimeWasRunning };
}

export async function listSnapshots(agentWorkspaceId: string) {
  return db.workspaceSnapshot.findMany({
    where: { agentWorkspaceId, status: { not: "deleted" } },
    orderBy: { createdAt: "desc" },
  });
}

/** Metadata-level comparison. Restoring is never implied by comparing. */
export async function compareSnapshots(agentWorkspaceId: string, leftId: string, rightId: string) {
  const [left, right] = await Promise.all([
    db.workspaceSnapshot.findFirst({ where: { id: leftId, agentWorkspaceId } }),
    db.workspaceSnapshot.findFirst({ where: { id: rightId, agentWorkspaceId } }),
  ]);
  if (!left || !right) throw new WorkspaceError("One or both snapshots were not found.", "snapshot_not_found");
  const leftGit = left.gitState as Record<string, unknown>;
  const rightGit = right.gitState as Record<string, unknown>;
  const leftFiles = left.fileState as Record<string, number>;
  const rightFiles = right.fileState as Record<string, number>;
  return {
    left: { id: left.id, name: left.name, createdAt: left.createdAt, sizeBytes: left.sizeBytes?.toString() ?? null, git: leftGit, files: leftFiles },
    right: { id: right.id, name: right.name, createdAt: right.createdAt, sizeBytes: right.sizeBytes?.toString() ?? null, git: rightGit, files: rightFiles },
    differences: {
      branchChanged: leftGit.branch !== rightGit.branch,
      fileCountDelta: (rightFiles.fileCount ?? 0) - (leftFiles.fileCount ?? 0),
      byteDelta: (rightFiles.totalBytes ?? 0) - (leftFiles.totalBytes ?? 0),
      sizeDelta: Number((right.sizeBytes ?? BigInt(0)) - (left.sizeBytes ?? BigInt(0))),
    },
  };
}

export async function deleteSnapshot(workspace: AgentWorkspace, snapshotId: string, actor: ActorContext) {
  const snapshot = await db.workspaceSnapshot.findFirst({ where: { id: snapshotId, agentWorkspaceId: workspace.id } });
  if (!snapshot) throw new WorkspaceError("Snapshot not found.", "snapshot_not_found");
  if (snapshot.storageRef) {
    await getRuntimeProvider(workspace.runtimeType).deleteSnapshot(snapshot.storageRef);
  }
  await db.workspaceSnapshot.update({ where: { id: snapshot.id }, data: { status: "deleted", storageRef: null } });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "snapshot.deleted",
    severity: "warn",
    message: `Snapshot "${snapshot.name}" deleted.`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { snapshotId: snapshot.id },
  });
}
