import { resolve } from "node:path";
import { RuntimeError } from "@/lib/agents/runtime/errors";
import { nodeRuntimeProcessRunner } from "@/lib/agents/runtime/runner";
import type { RuntimeInstance } from "@/lib/agents/runtime/types";

export interface EnsureWorktreeInput {
  runtime: RuntimeInstance;
  taskId: string;
  agentId: string;
  baseBranch?: string;
}

export interface WorktreeResult {
  path: string;
  branch: string;
}

/**
 * Creates (or reuses) one isolated git worktree per task under the
 * runtime's allowlisted project root, via the same sandboxed process
 * runner the runtime adapters already use to spawn `claude`/`codex` — no
 * separate git wrapper. The root itself must already be a git repository;
 * this only manages the additional worktrees layered on top of it. No
 * autonomous worker is ever pointed at the shared root directly once a
 * worktree exists for its task.
 */
export async function ensureTaskWorktree(input: EnsureWorktreeInput): Promise<WorktreeResult> {
  const root = input.runtime.workingDirectoryRoot;
  if (!root) throw new RuntimeError("Runtime has no allowlisted project root", "configuration_invalid", 503);
  const branch = `agent/${input.agentId}/${input.taskId}`;
  const path = resolve(root, "worktrees", `${input.taskId}-${input.agentId}`);

  const existing = await nodeRuntimeProcessRunner.run("git", ["worktree", "list", "--porcelain"], { cwd: root });
  if (existing.exitCode === 0 && existing.stdout.includes(path)) {
    return { path, branch };
  }

  const result = await nodeRuntimeProcessRunner.run(
    "git",
    ["worktree", "add", "-B", branch, path, input.baseBranch ?? "HEAD"],
    { cwd: root, timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) {
    throw new RuntimeError(`Failed to create worktree for ${input.taskId}: ${result.stderr || result.stdout}`, "worktree_create_failed", 503);
  }
  return { path, branch };
}

export async function removeTaskWorktree(runtime: RuntimeInstance, worktreePath: string): Promise<void> {
  const root = runtime.workingDirectoryRoot;
  if (!root) return;
  await nodeRuntimeProcessRunner
    .run("git", ["worktree", "remove", "--force", worktreePath], { cwd: root, timeoutMs: 30_000 })
    .catch(() => undefined);
}
