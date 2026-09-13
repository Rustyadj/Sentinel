import type { AgentWorkspace } from "@prisma/client";
import { WorkspaceError } from "./errors";
import { recordWorkspaceEvent } from "./events";
import { resolveWorkspacePath } from "./policy";
import { requireSecrets } from "./secrets";
import { runCommand } from "./exec";
import { recordWorkspaceMemoryReference } from "./memory-link";
import type { ActorContext } from "./service";

/** Quote a value so the workspace shell treats it strictly as one argument. */
function quote(value: string) {
  if (/[\0\r\n]/.test(value)) throw new WorkspaceError("Git argument contains control characters.", "invalid_body");
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function assertRemote(url: string) {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new WorkspaceError("Repository URL must be an absolute https:// URL.", "invalid_body");
  }
  if (parsed.protocol !== "https:") {
    throw new WorkspaceError("Only https:// repository URLs are supported.", "invalid_body");
  }
  if (parsed.username || parsed.password) {
    // Credentials belong in Sentinel's secret injection, never in a URL that
    // would be persisted in the command audit trail.
    throw new WorkspaceError("Remote URLs must not embed credentials.", "policy_violation");
  }
  return parsed.toString();
}

function assertRef(ref: string, label: string) {
  if (!/^[\w./-]{1,200}$/.test(ref)) throw new WorkspaceError(`Invalid ${label}.`, "invalid_body");
  return ref;
}

export type GitOperation = "status" | "clone" | "pull" | "fetch" | "branch" | "checkout" | "commit" | "diff" | "log";

export interface GitRequest {
  workspace: AgentWorkspace;
  operation: GitOperation;
  /** Repository directory relative to the workspace home. */
  path?: string;
  remoteUrl?: string;
  directory?: string;
  branch?: string;
  message?: string;
  addAll?: boolean;
  actor: ActorContext;
}

/**
 * Git is exposed as a fixed set of operations rather than raw `git` input, so
 * credentials are only ever injected for calls that actually talk to a remote.
 */
export async function runGit(request: GitRequest) {
  const { workspace, operation, actor } = request;
  const cwd = resolveWorkspacePath(workspace.homePath, request.path);
  const needsRemote = operation === "clone" || operation === "pull" || operation === "fetch";
  const secrets = needsRemote ? requireSecrets("git") : {};

  let command: string;
  let effectiveCwd = cwd;
  switch (operation) {
    case "status":
      command = "git status --porcelain=v1 --branch";
      break;
    case "clone": {
      if (!request.remoteUrl) throw new WorkspaceError("remoteUrl is required to clone.", "invalid_body");
      const url = assertRemote(request.remoteUrl);
      const target = resolveWorkspacePath(workspace.homePath, request.directory ?? request.path ?? "repos");
      effectiveCwd = workspace.homePath;
      command = `mkdir -p ${quote(target)} && git clone ${quote(url)} ${quote(target)}`;
      break;
    }
    case "pull":
      command = "git pull --ff-only";
      break;
    case "fetch":
      command = "git fetch --all --prune";
      break;
    case "branch":
      command = request.branch
        ? `git checkout -b ${quote(assertRef(request.branch, "branch name"))}`
        : "git branch -vv --all";
      break;
    case "checkout":
      if (!request.branch) throw new WorkspaceError("branch is required to check out.", "invalid_body");
      command = `git checkout ${quote(assertRef(request.branch, "branch name"))}`;
      break;
    case "commit": {
      if (!request.message?.trim()) throw new WorkspaceError("A commit message is required.", "invalid_body");
      if (request.message.length > 4000) throw new WorkspaceError("Commit message is too long.", "invalid_body");
      const stage = request.addAll ? "git add -A && " : "";
      command = `${stage}git commit -m ${quote(request.message)}`;
      break;
    }
    case "diff":
      command = "git --no-pager diff --stat && git --no-pager diff";
      break;
    case "log":
      command = "git --no-pager log --oneline -n 50";
      break;
    default:
      throw new WorkspaceError("Unsupported git operation.", "invalid_body");
  }

  const result = await runCommand({
    workspace,
    command,
    cwd: effectiveCwd,
    secrets,
    actor,
    metadata: { via: `git.${operation}` },
  });

  if (result.exitCode !== 0) {
    await recordWorkspaceEvent({
      agentWorkspaceId: workspace.id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "git.command",
      severity: "warn",
      message: `git ${operation} failed (exit ${result.exitCode}).`,
      actorUserId: actor.userId ?? null,
      source: actor.client,
      metadata: { operation, commandId: result.commandId },
    });
    throw new WorkspaceError(
      `git ${operation} failed: ${(result.stderr || result.stdout).trim().split("\n").slice(-3).join(" ").slice(0, 400) || "no output"}`,
      "git_failed",
    );
  }

  if (operation === "clone") {
    await recordWorkspaceEvent({
      agentWorkspaceId: workspace.id,
      tenantWorkspaceId: workspace.workspaceId,
      type: "repo.cloned",
      message: `Cloned ${request.remoteUrl} into ${result.cwd}`,
      actorUserId: actor.userId ?? null,
      actorAgentId: actor.agentId ?? workspace.agentId,
      source: actor.client,
      metadata: { remoteUrl: request.remoteUrl, directory: request.directory },
    });
    // A pointer, not a copy: memory learns the repository exists and where.
    await recordWorkspaceMemoryReference({
      workspace,
      content: `${workspace.agentId} cloned ${request.remoteUrl} into workspace "${workspace.name}" at ${request.directory ?? "repos"}.`,
      tags: ["repository"],
      importanceScore: 0.6,
    });
  }

  return result;
}

/** Cheap repository summary for the workspace header. Never throws. */
export async function gitSummary(workspace: AgentWorkspace, path: string | undefined, actor: ActorContext) {
  try {
    const result = await runCommand({
      workspace,
      command: 'git rev-parse --show-toplevel 2>/dev/null && git rev-parse --abbrev-ref HEAD && git status --porcelain=v1 | wc -l',
      cwd: resolveWorkspacePath(workspace.homePath, path),
      actor,
      metadata: { via: "git.summary" },
    });
    if (result.exitCode !== 0) return null;
    const [repoPath, branch, dirtyCount] = result.stdout.trim().split("\n");
    if (!repoPath) return null;
    return { repository: repoPath, branch: branch ?? null, dirtyFiles: Number.parseInt(dirtyCount ?? "0", 10) || 0 };
  } catch {
    return null;
  }
}
