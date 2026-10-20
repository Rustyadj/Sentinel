import type { AgentWorkspace } from "@prisma/client";
import { db } from "@/lib/db";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { assertClientAllowed, assertCommandShape, MAX_CAPTURED_OUTPUT_BYTES, parseLimits, parsePolicy, resolveWorkspacePath } from "./policy";
import { getRuntimeProvider } from "./providers";
import { redactSecrets } from "./secrets";
import { currentRuntime, requireRunningRuntime, type ActorContext } from "./service";
import type { ExecResult } from "./types";

export interface RunCommandInput {
  workspace: AgentWorkspace;
  command: string;
  cwd?: string;
  timeoutMs?: number;
  stdin?: string;
  signal?: AbortSignal;
  loginShell?: boolean;
  onStdout?: (chunk: string) => void;
  onStderr?: (chunk: string) => void;
  /** Injected per-exec; redacted from stored output. */
  secrets?: Record<string, string>;
  env?: Record<string, string>;
  touchActivity?: boolean;
  actor: ActorContext;
  /** Free-form provenance, e.g. { via: "git.clone" }. */
  metadata?: Record<string, unknown>;
}

export interface RunCommandOutput extends ExecResult {
  commandId: string;
  cwd: string;
}

/**
 * The single audited path for executing anything inside a workspace. Every
 * caller — UI, Hermes, Claude Code, Codex, git helpers — goes through here, so
 * there is exactly one place where commands are authorised, bounded, recorded
 * and redacted.
 */
export async function runCommand(input: RunCommandInput): Promise<RunCommandOutput> {
  const { workspace, actor } = input;
  const policy = parsePolicy(workspace.policy);
  assertClientAllowed(policy, actor.client);
  assertCommandShape(input.command);

  const limits = parseLimits(workspace.resourceLimits);
  const cwd = resolveWorkspacePath(workspace.homePath, input.cwd);
  const timeoutMs = Math.min(input.timeoutMs ?? limits.commandTimeoutMs, limits.commandTimeoutMs);

  const runtime = await requireRunningRuntime(workspace);
  const secrets = input.secrets ?? {};

  const row = await db.workspaceCommand.create({
    data: {
      agentWorkspaceId: workspace.id,
      runtimeId: runtime.id,
      agentId: actor.agentId ?? workspace.agentId,
      actorUserId: actor.userId ?? null,
      origin: actor.client,
      command: input.command,
      cwd,
      status: "running",
      metadata: { ...(input.metadata ?? {}), injectedSecretKeys: Object.keys(secrets) },
    },
  });

  // Buffer partial lines so a credential split across transport chunks cannot
  // escape redaction into runtime/session events.
  const forward = (callback?: (chunk: string) => void) => {
    let pending = "";
    return {
      write(chunk: string) {
        pending += chunk;
        const end = pending.lastIndexOf("\n");
        if (end >= 0) { callback?.(redactSecrets(pending.slice(0, end + 1), secrets)); pending = pending.slice(end + 1); }
      },
      end() { if (pending) callback?.(redactSecrets(pending, secrets)); },
    };
  };
  const out = forward(input.onStdout), err = forward(input.onStderr);
  let result: ExecResult;
  try {
    result = await getRuntimeProvider(workspace.runtimeType).executeCommand({
      workspaceId: workspace.id,
      command: input.command,
      cwd,
      timeoutMs,
      env: { ...input.env, ...secrets },
      stdin: input.stdin,
      signal: input.signal,
      loginShell: input.loginShell,
      onStdout: out.write,
      onStderr: err.write,
    });
  } catch (error) {
    const message = error instanceof WorkspaceError ? error.message : "Command execution failed.";
    await db.workspaceCommand.update({
      where: { id: row.id },
      data: { status: "failed", finishedAt: new Date(), stderr: message, exitCode: null },
    });
    throw error;
  }

  out.end(); err.end();
  const stdout = redactSecrets(result.stdout, secrets).slice(0, MAX_CAPTURED_OUTPUT_BYTES);
  const stderr = redactSecrets(result.stderr, secrets).slice(0, MAX_CAPTURED_OUTPUT_BYTES);
  const status = result.timedOut ? "timed_out" : result.exitCode === 0 ? "succeeded" : "failed";

  await db.workspaceCommand.update({
    where: { id: row.id },
    data: {
      status,
      exitCode: result.exitCode,
      stdout,
      stderr,
      truncated: result.truncated,
      finishedAt: new Date(),
      durationMs: result.durationMs,
    },
  });
  if (input.touchActivity !== false) await db.agentWorkspace.update({ where: { id: workspace.id }, data: { lastActiveAt: new Date() } });

  await recordWorkspaceEvent({
    agentWorkspaceId: workspace.id,
    tenantWorkspaceId: workspace.workspaceId,
    type: "command.executed",
    severity: status === "succeeded" ? "info" : "warn",
    actorUserId: actor.userId ?? null,
    actorAgentId: actor.agentId ?? workspace.agentId,
    source: actor.client,
    message: `${input.command.slice(0, 160)} -> ${status}`,
    metadata: { commandId: row.id, exitCode: result.exitCode, durationMs: result.durationMs, cwd, ...(input.metadata ?? {}) },
  });

  return { ...result, stdout, stderr, commandId: row.id, cwd };
}

export async function listCommands(agentWorkspaceId: string, limit = 50) {
  return db.workspaceCommand.findMany({
    where: { agentWorkspaceId },
    orderBy: { startedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 200),
  });
}

export async function getCommand(agentWorkspaceId: string, commandId: string) {
  const command = await db.workspaceCommand.findFirst({ where: { id: commandId, agentWorkspaceId } });
  if (!command) throw new WorkspaceError("Command not found.", "workspace_not_found");
  return command;
}

export async function activeRuntimeId(agentWorkspaceId: string) {
  return (await currentRuntime(agentWorkspaceId))?.id ?? null;
}
