import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { nodeRuntimeProcessRunner } from "@/lib/agents/runtime/runner";
import type { RuntimeInstance } from "@/lib/agents/runtime/types";
import { ensureTaskWorktree, removeTaskWorktree } from "./worktree-manager";

async function makeRepo(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), "sentinel-worktree-test-"));
  await nodeRuntimeProcessRunner.run("git", ["init", "-q"], { cwd: root });
  await nodeRuntimeProcessRunner.run("git", ["config", "user.email", "test@example.com"], { cwd: root });
  await nodeRuntimeProcessRunner.run("git", ["config", "user.name", "Test"], { cwd: root });
  await writeFile(join(root, "README.md"), "hello\n");
  await nodeRuntimeProcessRunner.run("git", ["add", "."], { cwd: root });
  await nodeRuntimeProcessRunner.run("git", ["commit", "-q", "-m", "init"], { cwd: root });
  return root;
}

function runtimeAt(root: string): RuntimeInstance {
  return { id: "runtime-test", agentId: "test-agent", kind: "claude-code", transport: "process", workingDirectoryRoot: root };
}

const cleanupRoots: string[] = [];
afterEach(async () => {
  while (cleanupRoots.length) await rm(cleanupRoots.pop()!, { recursive: true, force: true });
});

describe("worktree manager", () => {
  it("creates one isolated worktree per task, on its own branch, under the runtime root", async () => {
    const root = await makeRepo();
    cleanupRoots.push(root);
    const runtime = runtimeAt(root);

    const worktree = await ensureTaskWorktree({ runtime, taskId: "TASK-1", agentId: "claude-code" });
    expect(worktree.branch).toBe("agent/claude-code/TASK-1");
    expect(worktree.path).toContain("TASK-1-claude-code");

    const content = await readFile(join(worktree.path, "README.md"), "utf8");
    expect(content).toBe("hello\n");

    const list = await nodeRuntimeProcessRunner.run("git", ["worktree", "list", "--porcelain"], { cwd: root });
    expect(list.stdout).toContain(worktree.path);
  });

  it("gives two different tasks two different worktrees so neither can step on the other's files", async () => {
    const root = await makeRepo();
    cleanupRoots.push(root);
    const runtime = runtimeAt(root);

    const a = await ensureTaskWorktree({ runtime, taskId: "TASK-A", agentId: "claude-code" });
    const b = await ensureTaskWorktree({ runtime, taskId: "TASK-B", agentId: "claude-code" });
    expect(a.path).not.toBe(b.path);
    expect(a.branch).not.toBe(b.branch);

    await writeFile(join(a.path, "only-in-a.txt"), "a\n");
    await expect(readFile(join(b.path, "only-in-a.txt"), "utf8")).rejects.toThrow();
  });

  it("reuses the same worktree on a second call for the same task instead of failing", async () => {
    const root = await makeRepo();
    cleanupRoots.push(root);
    const runtime = runtimeAt(root);

    const first = await ensureTaskWorktree({ runtime, taskId: "TASK-1", agentId: "codex" });
    const second = await ensureTaskWorktree({ runtime, taskId: "TASK-1", agentId: "codex" });
    expect(second.path).toBe(first.path);
  });

  it("removes a worktree cleanly", async () => {
    const root = await makeRepo();
    cleanupRoots.push(root);
    const runtime = runtimeAt(root);

    const worktree = await ensureTaskWorktree({ runtime, taskId: "TASK-1", agentId: "codex" });
    await removeTaskWorktree(runtime, worktree.path);

    const list = await nodeRuntimeProcessRunner.run("git", ["worktree", "list", "--porcelain"], { cwd: root });
    expect(list.stdout).not.toContain(worktree.path);
  });
});
