import { isPersonalComputer, personalComputerRunner } from "@/lib/agents/runtime/workspace-runner";
import { resolve } from "node:path";
import { RuntimeError } from "@/lib/agents/runtime/errors";
import { nodeRuntimeProcessRunner } from "@/lib/agents/runtime/runner";
import type { RuntimeInstance } from "@/lib/agents/runtime/types";

export interface EnsureWorktreeInput {
  runtime: RuntimeInstance;
  taskId: string;
  agentId: string;
  baseBranch?: string;
  userId?: string;
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
  for (const value of [input.agentId, input.taskId]) {
    if (!/^[a-zA-Z0-9_-]+$/.test(value)) throw new RuntimeError("Invalid worktree identity", "invalid_argument", 400);
  }
  if (input.agentId !== input.runtime.agentId) throw new RuntimeError("Runtime identity mismatch", "workspace_mismatch", 403);
  const computer = isPersonalComputer(input.runtime) ? await personalComputerRunner(input.runtime, input.userId) : null;
  const runner = computer?.runner ?? nodeRuntimeProcessRunner;
  const root = computer?.root ?? input.runtime.workingDirectoryRoot;
  if (!root) throw new RuntimeError("Runtime has no allowlisted project root", "configuration_invalid", 503);
  const branch = `agent/${input.agentId}/${input.taskId}`;
  const path = resolve(root, "worktrees", `${input.taskId}-${input.agentId}`);

  const existing = await runner.run("git", ["worktree", "list", "--porcelain"], { cwd: root });
  if (existing.exitCode === 0 && existing.stdout.split("\n").includes(`worktree ${path}`)) {
    return { path, branch };
  }

  const branchExists = await runner.run("git", ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`], { cwd: root });
  const result = await runner.run(
    "git",
    branchExists.exitCode === 0 ? ["worktree", "add", path, branch] : ["worktree", "add", "-b", branch, path, input.baseBranch ?? "HEAD"],
    { cwd: root, timeoutMs: 30_000 },
  );
  if (result.exitCode !== 0) {
    throw new RuntimeError(`Failed to create worktree for ${input.taskId}: ${result.stderr || result.stdout}`, "worktree_create_failed", 503);
  }
  return { path, branch };
}

export async function removeTaskWorktree(runtime: RuntimeInstance, worktreePath: string): Promise<void> {
  const computer = isPersonalComputer(runtime) ? await personalComputerRunner(runtime) : null;
  const runner = computer?.runner ?? nodeRuntimeProcessRunner;
  const root = computer?.root ?? runtime.workingDirectoryRoot;
  if (!root) return;
  await runner
    .run("git", ["worktree", "remove", "--force", worktreePath], { cwd: root, timeoutMs: 30_000 })
    .catch(() => undefined);
}

export interface MergeResult {
  merged: boolean;
  conflict?: string;
}

/**
 * Merges a task's worktree branch back into whatever is currently checked
 * out in the runtime's own root (real `git merge`, not a status flag) —
 * this is what "Lisa reconciles parallel work" actually does on disk. On
 * conflict, aborts the merge so the root is left clean for the next
 * attempt rather than stuck mid-merge, and returns the conflict text for
 * Lisa to reason about (retry a narrower fix, hand off, or ask the user).
 */
export async function mergeTaskBranch(runtime: RuntimeInstance, branch: string, userId?: string): Promise<MergeResult> {
  const computer = isPersonalComputer(runtime) ? await personalComputerRunner(runtime, userId) : null;
  const runner = computer?.runner ?? nodeRuntimeProcessRunner;
  const root = computer?.root ?? runtime.workingDirectoryRoot;
  if (!root) throw new RuntimeError("Runtime has no allowlisted project root", "configuration_invalid", 503);
  const result = await runner.run("git", ["merge", "--no-ff", branch, "-m", `Merge ${branch}`], { cwd: root, timeoutMs: 30_000 });
  if (result.exitCode !== 0) {
    await runner.run("git", ["merge", "--abort"], { cwd: root, timeoutMs: 30_000 }).catch(() => undefined);
    return { merged: false, conflict: (result.stderr || result.stdout).slice(0, 2_000) };
  }
  return { merged: true };
}
