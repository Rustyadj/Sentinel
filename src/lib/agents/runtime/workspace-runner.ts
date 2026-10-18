import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import posix from "node:path/posix";
import { resolveDefaultAgentWorkspace } from "@/lib/agent-workspaces/defaults";
import { authorizeAgentRequest } from "@/lib/agent-workspaces/gateway";
import { AGENT_WORKSPACE_PERMISSIONS, assertUserWorkspaceAccess } from "@/lib/agent-workspaces/authorization";
import { requireRunningRuntime } from "@/lib/agent-workspaces/service";
import { runCommand } from "@/lib/agent-workspaces/exec";
import { resolveWorkspacePath } from "@/lib/agent-workspaces/policy";
import { WorkspaceError } from "@/lib/agent-workspaces/errors";
import type { RuntimeInstance } from "./types";
import type { RuntimeProcessRunner, SpawnedRuntimeProcess } from "./runner";
import type { SpawnOptionsWithoutStdio } from "node:child_process";

export function isPersonalComputer(runtime: RuntimeInstance) {
  return runtime.kind === "claude-code" || runtime.kind === "codex";
}

export function shellArg(value: string) { return `'${value.replaceAll("'", "'\\''")}'`; }

export function codingCredential(kind: string): Record<string, string> {
  const hostKey = kind === "claude-code" ? "SENTINEL_CLAUDE_CODE_API_KEY" : "SENTINEL_CODEX_API_KEY";
  const value = process.env[hostKey]?.trim();
  if (!value) throw new WorkspaceError(`Configure ${hostKey} on Sentinel before executing this agent.`, "policy_violation");
  return { [kind === "claude-code" ? "ANTHROPIC_API_KEY" : "CODEX_API_KEY"]: value };
}

/** Uses the same gateway, command audit, limits and provider as the workspace UI. */
export async function personalComputerRunner(runtime: RuntimeInstance, userId?: string) {
  if (runtime.agentId !== runtime.kind) throw new WorkspaceError("Coding runtime identity mismatch.", "workspace_forbidden");
  const workspace = await resolveDefaultAgentWorkspace({ agentId: runtime.agentId });
  const client = runtime.kind as "claude-code" | "codex";
  const grant = await authorizeAgentRequest({ agentWorkspaceId: workspace.id, actingAgentId: runtime.agentId, client, requiredLevel: "write" });
  if (userId) await assertUserWorkspaceAccess(workspace.id, userId, AGENT_WORKSPACE_PERMISSIONS.execute);
  await requireRunningRuntime(workspace);
  const root = posix.join(workspace.homePath, "projects");
  const env = { HOME: workspace.homePath, CLAUDE_CONFIG_DIR: posix.join(workspace.homePath, ".claude"), CODEX_HOME: posix.join(workspace.homePath, ".codex") };
  const actor = { ...grant.actor, userId };
  const checkedPath = (value: string) => {
    if (posix.isAbsolute(value) && value !== workspace.homePath && !value.startsWith(`${workspace.homePath}/`)) {
      throw new WorkspaceError("Path escapes the workspace root.", "path_escape");
    }
    return resolveWorkspacePath(workspace.homePath, value);
  };
  const refresh = async () => {
    const current = await authorizeAgentRequest({ agentWorkspaceId: workspace.id, actingAgentId: runtime.agentId, client, requiredLevel: "write" });
    if (userId) await assertUserWorkspaceAccess(workspace.id, userId, AGENT_WORKSPACE_PERMISSIONS.execute);
    return current.workspace;
  };
  const runner: RuntimeProcessRunner = {
    async run(executable, args, options = {}) {
      const cwd = checkedPath(options.cwd ?? workspace.homePath);
      const result = await runCommand({ workspace: await refresh(), actor, cwd, command: [executable, ...args].map(shellArg).join(" "), timeoutMs: options.timeoutMs,
        env, loginShell: false, touchActivity: options.probe !== true && !args.includes("--version"), metadata: { runtimeId: runtime.id, via: "coding-runtime" } });
      return { stdout: result.stdout, stderr: result.stderr, exitCode: result.exitCode };
    },
    spawn(executable: string, args: string[], options: SpawnOptionsWithoutStdio) {
      // Prompts have a 100k-character adapter limit, while audited shell
      // commands are intentionally capped at 16k. Keep prompt data on stdin.
      const commandArgs = [...args];
      let stdin: string | undefined;
      if (executable === "claude" && commandArgs.includes("-p")) {
        const index = commandArgs.indexOf("-p") + 1;
        stdin = commandArgs.splice(index, 1)[0];
      } else if (executable === "codex" && commandArgs.includes("exec")) {
        stdin = commandArgs.pop();
        commandArgs.push("-");
      }
      const child = new EventEmitter() as SpawnedRuntimeProcess;
      const stdout = new PassThrough(), stderr = new PassThrough();
      Object.assign(child, { stdout, stderr });
      const controller = new AbortController();
      child.kill = () => { controller.abort(); return true; };
      // Defer completion so the adapter can attach error/close listeners.
      void Promise.resolve().then(async () => {
        try {
          const result = await runCommand({ workspace: await refresh(), actor, cwd: checkedPath(String(options.cwd ?? root)),
            command: [executable, ...commandArgs].map(shellArg).join(" "), stdin, timeoutMs: 10 * 60_000,
            env, loginShell: false, secrets: codingCredential(client), signal: controller.signal,
            onStdout: chunk => stdout.write(chunk), onStderr: chunk => stderr.write(chunk),
            metadata: { runtimeId: runtime.id, via: "coding-runtime", ...(stdin !== undefined ? { promptLength: stdin.length } : {}) } });
          stdout.end(); stderr.end(); child.emit("close", result.exitCode, controller.signal.aborted ? "SIGTERM" : null);
        } catch (error) { stdout.end(); stderr.end(); child.emit("error", error); }
      });
      return child;
    },
    async realpath(path) {
      const requested = checkedPath(path);
      const result = await runner.run("realpath", ["-e", requested]);
      if (result.exitCode !== 0) throw new WorkspaceError("Workspace directory does not exist.", "file_not_found");
      return checkedPath(result.stdout.trim());
    },
  };
  return { runner, workspace, root, executable: client === "claude-code" ? "claude" : "codex" };
}
