import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In production the app has no git and no project root; claude-code/codex
// worktrees (roundtable seats, direct @mention replies) are made by
// orchestration-worker over the runtime-calls channel. Before this, every such
// turn failed with `spawn git ENOENT`.

import { executeRuntimeCall } from "@/lib/agents/runtime/execution-host";
import type { RuntimeCallPayload, RuntimeCallReply, RuntimeCallRequest } from "@/lib/agents/runtime/remote-execution";
import { nodeRuntimeProcessRunner } from "@/lib/agents/runtime/runner";
import type { AgentRuntimeAdapter, RuntimeInstance } from "@/lib/agents/runtime/types";
import { ensureTaskWorktree, isSafeWorktreeSegment, setWorktreeTransportForTests } from "@/lib/orchestration/worktree-manager";

const runtime: RuntimeInstance = {
  id: "runtime-claude-code", agentId: "claude-code", kind: "claude-code", transport: "process",
  executable: "/opt/runtime-bin/claude", workingDirectoryRoot: "/opt/sentinel-os/projects",
};

beforeEach(() => { vi.stubEnv("SENTINEL_CLI_RUNTIME_HOST", ""); });
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
  setWorktreeTransportForTests();
});

describe("worktrees from the app", () => {
  it("are requested from the worker by runtime id, and never spawn git here", async () => {
    vi.stubEnv("SENTINEL_CLI_RUNTIME_HOST", "false");
    const run = vi.spyOn(nodeRuntimeProcessRunner, "run");
    const requests: RuntimeCallRequest[] = [];
    setWorktreeTransportForTests({
      async *call(request) {
        requests.push(request);
        yield { t: "accepted" };
        yield { t: "result", value: { path: "/opt/sentinel-os/projects/worktrees/roundtable-d1-claude-code", branch: "agent/claude-code/roundtable-d1" } };
      },
    });
    const result = await ensureTaskWorktree({ runtime, taskId: "roundtable-d1", agentId: "claude-code" });
    expect(result.path).toBe("/opt/sentinel-os/projects/worktrees/roundtable-d1-claude-code");
    expect(requests).toEqual([{ kind: "claude-code", method: "ensureWorktree", args: ["runtime-claude-code", "roundtable-d1", "claude-code"] }]);
    expect(run).not.toHaveBeenCalled();
  });

  it("surface a worker-side failure as the original error", async () => {
    vi.stubEnv("SENTINEL_CLI_RUNTIME_HOST", "false");
    setWorktreeTransportForTests({
      async *call() {
        yield { t: "error", error: { name: "RuntimeError", message: "Failed to create worktree", code: "worktree_create_failed", status: 503 } } as RuntimeCallReply;
      },
    });
    await expect(ensureTaskWorktree({ runtime, taskId: "direct-room", agentId: "claude-code" })).rejects.toMatchObject({ code: "worktree_create_failed" });
  });
});

describe("worktrees on the worker", () => {
  function host() {
    const replies: RuntimeCallReply[] = [];
    const run = (payload: Omit<RuntimeCallPayload, "callId">) => executeRuntimeCall({ callId: "c1", ...payload }, async (reply) => { replies.push(reply); }, {
      adapterFor: () => ({}) as AgentRuntimeAdapter,
      resolveRuntime: async (id) => (id === runtime.id ? runtime : null),
    });
    return { replies, run };
  }

  it("runs git in the re-resolved runtime's root", async () => {
    vi.stubEnv("SENTINEL_CLI_RUNTIME_HOST", "true");
    const run = vi.spyOn(nodeRuntimeProcessRunner, "run").mockResolvedValue({ exitCode: 0, stdout: "", stderr: "" } as never);
    const { replies, run: call } = host();
    await call({ kind: "claude-code", method: "ensureWorktree", args: ["runtime-claude-code", "roundtable-d1", "claude-code"] });
    expect(replies.at(-1)).toMatchObject({ t: "result", value: { path: "/opt/sentinel-os/projects/worktrees/roundtable-d1-claude-code" } });
    expect(run).toHaveBeenLastCalledWith("git", ["worktree", "add", "-B", "agent/claude-code/roundtable-d1", "/opt/sentinel-os/projects/worktrees/roundtable-d1-claude-code", "HEAD"], expect.objectContaining({ cwd: "/opt/sentinel-os/projects" }));
  });

  it("refuses traversal in the task id and another agent's name", async () => {
    const run = vi.spyOn(nodeRuntimeProcessRunner, "run");
    const { replies, run: call } = host();
    await call({ kind: "claude-code", method: "ensureWorktree", args: ["runtime-claude-code", "../../etc", "claude-code"] });
    await call({ kind: "claude-code", method: "ensureWorktree", args: ["runtime-claude-code", "a/b", "claude-code"] });
    await call({ kind: "claude-code", method: "ensureWorktree", args: ["runtime-claude-code", "roundtable-d1", "codex"] });
    expect(replies.filter((reply) => reply.t === "error")).toHaveLength(3);
    expect(run).not.toHaveBeenCalled();
  });

  it("accepts the task ids Sentinel actually makes", () => {
    expect(isSafeWorktreeSegment("roundtable-cmwl2l52z07ktmy01a9v7mjco")).toBe(true);
    expect(isSafeWorktreeSegment("direct-cmse53o8h01app4014ql3kqh8")).toBe(true);
    expect(isSafeWorktreeSegment("..")).toBe(false);
    expect(isSafeWorktreeSegment("")).toBe(false);
  });
});
