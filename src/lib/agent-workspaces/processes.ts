import type { AgentWorkspace } from "@prisma/client";
import { db } from "@/lib/db";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { assertCommandShape, resolveWorkspacePath } from "./policy";
import { getRuntimeProvider } from "./providers";
import { runCommand } from "./exec";
import { requireRunningRuntime, currentRuntime, type ActorContext } from "./service";

const LOG_DIR = ".sentinel/logs";

/**
 * Long-lived work (dev servers, watchers, test runners) is detached inside the
 * workspace with its output tailed to a file, so Sentinel keeps identity, logs
 * and ports without holding the request open.
 */
export async function startProcess(input: {
  workspace: AgentWorkspace;
  label: string;
  command: string;
  cwd?: string;
  ports?: number[];
  actor: ActorContext;
}) {
  const { workspace, actor } = input;
  assertCommandShape(input.command);
  if (!input.label.trim() || input.label.length > 120) {
    throw new WorkspaceError("A process label is required (max 120 characters).", "invalid_body");
  }
  const ports = (input.ports ?? []).filter((port) => Number.isInteger(port) && port > 0 && port < 65536);
  const cwd = resolveWorkspacePath(workspace.homePath, input.cwd);
  await requireRunningRuntime(workspace);

  const record = await db.workspaceProcess.create({
    data: {
      agentWorkspaceId: workspace.id,
      runtimeId: (await currentRuntime(workspace.id))?.id ?? null,
      agentId: actor.agentId ?? workspace.agentId,
      label: input.label.trim(),
      command: input.command,
      cwd,
      ports,
      status: "running",
      metadata: { origin: actor.client, startedByUserId: actor.userId ?? null },
    },
  });

  const logPath = `${workspace.homePath}/${LOG_DIR}/${record.id}.log`;
  // Detach in two steps: prepare the log directory, then launch and report the
  // pid on its own line, so the pid never has to be recovered from mixed output.
  const launch = await runCommand({
    workspace,
    command: [
      `mkdir -p '${workspace.homePath}/${LOG_DIR}'`,
      `setsid nohup bash -lc ${JSON.stringify(input.command)} > '${logPath}' 2>&1 < /dev/null &`,
      `printf 'sentinel-pid:%s\\n' "$!"`,
    ].join("\n"),
    cwd,
    actor,
    metadata: { via: "process.start", processId: record.id },
  });

  const pidLine = launch.stdout.split("\n").find((line) => line.startsWith("sentinel-pid:"));
  const pid = Number.parseInt(pidLine?.slice("sentinel-pid:".length) ?? "", 10);
  const updated = await db.workspaceProcess.update({
    where: { id: record.id },
    data: {
      pid: Number.isFinite(pid) ? pid : null,
      logPath,
      status: launch.exitCode === 0 ? "running" : "exited",
      exitCode: launch.exitCode === 0 ? null : launch.exitCode,
      lastSeenAt: new Date(),
    },
  });

  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "process.started",
    message: `Started process "${updated.label}" (pid ${updated.pid ?? "unknown"}).`,
    actorUserId: actor.userId ?? null,
    actorAgentId: actor.agentId ?? workspace.agentId,
    source: actor.client,
    metadata: { processId: updated.id, pid: updated.pid, ports },
  });
  return updated;
}

/** Tracked processes reconciled against the live process table. */
export async function listProcesses(workspace: AgentWorkspace) {
  const tracked = await db.workspaceProcess.findMany({
    where: { agentWorkspaceId: workspace.id, status: { in: ["running", "unknown"] } },
    orderBy: { startedAt: "desc" },
  });
  const runtime = await currentRuntime(workspace.id);
  if (!runtime || runtime.state !== "RUNNING") {
    return { live: [], tracked: tracked.map((process) => ({ ...process, status: "unknown" })) };
  }
  const live = await getRuntimeProvider(workspace.runtimeType).getProcesses(workspace.id);
  const livePids = new Set(live.map((entry) => entry.pid));
  const reconciled = await Promise.all(tracked.map(async (process) => {
    if (process.pid && !livePids.has(process.pid)) {
      return db.workspaceProcess.update({
        where: { id: process.id },
        data: { status: "exited", stoppedAt: process.stoppedAt ?? new Date(), lastSeenAt: new Date() },
      });
    }
    return db.workspaceProcess.update({ where: { id: process.id }, data: { lastSeenAt: new Date() } });
  }));
  return { live, tracked: reconciled };
}

export async function stopProcess(workspace: AgentWorkspace, processId: string, actor: ActorContext) {
  const record = await db.workspaceProcess.findFirst({ where: { id: processId, agentWorkspaceId: workspace.id } });
  if (!record) throw new WorkspaceError("Process not found.", "workspace_not_found");
  if (!record.pid) throw new WorkspaceError("This process has no recorded pid and cannot be terminated.", "command_failed");
  await requireRunningRuntime(workspace);
  await getRuntimeProvider(workspace.runtimeType).killProcess(workspace.id, record.pid);
  const updated = await db.workspaceProcess.update({
    where: { id: record.id },
    data: { status: "killed", stoppedAt: new Date() },
  });
  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "process.stopped",
    message: `Stopped process "${record.label}" (pid ${record.pid}).`,
    actorUserId: actor.userId ?? null,
    source: actor.client,
    metadata: { processId: record.id, pid: record.pid },
  });
  return updated;
}

export async function readProcessLog(workspace: AgentWorkspace, processId: string, lines: number, actor: ActorContext) {
  const record = await db.workspaceProcess.findFirst({ where: { id: processId, agentWorkspaceId: workspace.id } });
  if (!record?.logPath) throw new WorkspaceError("No log file is recorded for this process.", "file_not_found");
  const result = await runCommand({
    workspace,
    command: `tail -n ${Math.min(Math.max(lines, 1), 2000)} '${record.logPath}'`,
    actor,
    metadata: { via: "process.logs", processId },
  });
  return { processId, lines: result.stdout.split("\n") };
}
