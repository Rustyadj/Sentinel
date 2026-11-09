import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// In production the app never runs claude/codex/gemini (docs/SECURITY_REMEDIATION.md
// §3 step 4). A chat turn for a CLI runtime becomes a job on the "runtime-calls"
// queue that orchestration-worker consumes, and its events come back on a Redis
// stream. These tests drive the real chat routing and runtime service with BullMQ
// and ioredis replaced by in-memory fakes, and spy on every process runner.

const m = vi.hoisted(() => {
  type Reply = Record<string, unknown>;
  const streams = new Map<string, Reply[]>();
  const jobs: Array<{ name: string; data: Record<string, unknown>; opts: Record<string, unknown> }> = [];
  // What the fake worker answers, per method. Replaced per test.
  let responder: (data: Record<string, unknown>) => Reply[] = () => [];
  return {
    streams, jobs,
    setResponder(fn: typeof responder) { responder = fn; },
    respond(data: Record<string, unknown>) { return responder(data); },
    persistChatExchange: vi.fn(),
    writeAuditLog: vi.fn(),
    runtime: { id: "runtime-claude-code", agentId: "claude-code", kind: "claude-code", transport: "process", workspaceId: "workspace-a", executable: "/opt/runtime-bin/claude" },
  };
});

vi.mock("bullmq", () => ({
  Queue: class {
    constructor(readonly name: string) {}
    async add(name: string, data: Record<string, unknown>, opts: Record<string, unknown>) {
      m.jobs.push({ name, data, opts });
      m.streams.set(String(data.callId), [{ t: "accepted" }, ...m.respond(data)]);
      return { remove: async () => undefined };
    }
    async close() {}
  },
}));

vi.mock("ioredis", () => ({
  default: class {
    on() { return this; }
    async connect() {}
    disconnect() {}
    async xread(...args: unknown[]) {
      const key = String(args[args.length - 2]);
      const after = Number(String(args[args.length - 1]).split("-")[0]);
      // Keyed by call id: the stream key's prefix is BULLMQ_PREFIX, which the suite sets.
      const entries = (m.streams.get(key.slice(key.lastIndexOf(":") + 1)) ?? []).map((reply, index) => [`${index + 1}-0`, ["m", JSON.stringify(reply)]] as const)
        .filter(([id]) => Number(id.split("-")[0]) > after);
      return entries.length ? [[key, entries]] : null;
    }
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    chatRoom: { findFirst: vi.fn().mockResolvedValue({ id: "room-a", projectId: "project-a" }) },
    agentSession: {
      findFirst: vi.fn().mockResolvedValue({ id: "session-a", runtimeInstanceId: "runtime-claude-code", userId: "user-a", chatRoomId: "room-a", status: "ready" }),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/chat/persistence", () => ({ persistChatExchange: m.persistChatExchange }));
vi.mock("@/lib/knowledge/retrieval", () => ({ appendSessionMemory: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/neural-engine/chat-capture", () => ({ captureAgentTurn: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/workspaces/audit", () => ({ writeAuditLog: m.writeAuditLog }));
vi.mock("@/lib/agents/runtime/authorization", () => ({
  RUNTIME_PERMISSIONS: { execute: "execute" },
  requireRuntimeAccess: vi.fn().mockResolvedValue({ runtime: m.runtime }),
  validateSessionScope: vi.fn(),
}));
vi.mock("@/lib/agents/runtime/store", () => ({
  runtimeSessionStore: {
    update: vi.fn(),
    append: vi.fn(),
    get: vi.fn().mockResolvedValue({ metadata: { actualModel: "claude-opus-5-5" } }),
  },
}));

import { ModelUnavailableError } from "@/lib/agents/model-policy";
import { routeRuntimeChat } from "@/lib/agents/runtime/chat-routing";
import { executeRuntimeCall } from "@/lib/agents/runtime/execution-host";
import { RuntimeError } from "@/lib/agents/runtime/errors";
import { forbiddenProcessRunner, RemoteCliRuntimeAdapter } from "@/lib/agents/runtime/remote-adapter";
import { cliRuntimeExecution, deserializeRuntimeError, serializeRuntimeError, type RuntimeCallPayload, type RuntimeCallReply } from "@/lib/agents/runtime/remote-execution";
import { nodeRuntimeProcessRunner } from "@/lib/agents/runtime/runner";
import { getRuntimeAdapter, setRuntimeCallTransportForTests } from "@/lib/agents/runtime/service";
import type { AgentRuntimeAdapter, RuntimeEvent, RuntimeInstance } from "@/lib/agents/runtime/types";

const event = (sequence: number, text: string): RuntimeEvent => ({
  type: "assistant_delta", sessionId: "session-a", sequence, timestamp: new Date(0).toISOString(), data: { text },
});

function spyOnEveryRunner() {
  return [
    vi.spyOn(nodeRuntimeProcessRunner, "spawn"),
    vi.spyOn(nodeRuntimeProcessRunner, "run"),
    vi.spyOn(forbiddenProcessRunner, "spawn"),
    vi.spyOn(forbiddenProcessRunner, "run"),
  ];
}

beforeEach(() => {
  m.jobs.length = 0;
  m.streams.clear();
  vi.stubEnv("REDIS_URL", "redis://redis:6379");
  vi.stubEnv("SENTINEL_CLI_RUNTIME_HOST", "");
  setRuntimeCallTransportForTests();
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("where CLI runtimes execute", () => {
  it("delegates in production and on explicit request, runs locally only on the runtime host or outside production", () => {
    vi.stubEnv("NODE_ENV", "production");
    expect(cliRuntimeExecution()).toBe("worker");
    vi.stubEnv("SENTINEL_CLI_RUNTIME_HOST", "true");
    expect(cliRuntimeExecution()).toBe("local");
    vi.stubEnv("NODE_ENV", "development");
    vi.stubEnv("SENTINEL_CLI_RUNTIME_HOST", "false");
    expect(cliRuntimeExecution()).toBe("worker");
    vi.stubEnv("SENTINEL_CLI_RUNTIME_HOST", "");
    expect(cliRuntimeExecution()).toBe("local");
  });

  it("hands the app a remote adapter for every CLI kind and the local one for Hermes", () => {
    vi.stubEnv("NODE_ENV", "production");
    for (const kind of ["claude-code", "codex", "gemini"] as const) expect(getRuntimeAdapter(kind)).toBeInstanceOf(RemoteCliRuntimeAdapter);
    expect(getRuntimeAdapter("hermes")).not.toBeInstanceOf(RemoteCliRuntimeAdapter);
  });
});

describe("chat with Claude Code in production", () => {
  it("enqueues the turn for orchestration-worker, streams its events back and never spawns a process", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const spies = spyOnEveryRunner();
    m.setResponder((data) => data.method === "readiness"
      ? [{ t: "alive" }, { t: "result", value: { ready: true } }]
      : [{ t: "event", event: event(1, "hello ") }, { t: "alive" }, { t: "event", event: event(2, "from the worker") }, { t: "result", value: null }]);

    const response = await routeRuntimeChat({ agentId: "claude-code", userId: "user-a", roomId: "room-a", userContent: "hi", mode: "coding_runtime" });
    const body = await response.text();

    expect(m.jobs.map((job) => job.name)).toEqual(["readiness", "send"]);
    for (const job of m.jobs) {
      expect(job.data.kind).toBe("claude-code");
      expect(job.opts).toMatchObject({ attempts: 1 });
    }
    // Only the id crosses: the worker resolves the executable itself.
    expect(m.jobs[0].data.args).toEqual(["runtime-claude-code"]);
    expect(m.jobs[1].data.args).toEqual([{ sessionId: "session-a", prompt: "hi", userId: "user-a" }]);
    expect(body).toContain('"text":"hello "');
    expect(body).toContain('"text":"from the worker"');
    expect(m.persistChatExchange).toHaveBeenCalledWith(expect.objectContaining({ assistantContent: "hello from the worker", agentId: "claude-code" }));
    for (const spy of spies) expect(spy).not.toHaveBeenCalled();
  });

  it("surfaces a worker-side MODEL_UNAVAILABLE as the same error the in-process path produced", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const failure = new ModelUnavailableError("claude-code", "claude-opus-9", "high", "model not found");
    m.setResponder((data) => data.method === "readiness"
      ? [{ t: "result", value: { ready: true } }]
      : [{ t: "error", error: serializeRuntimeError(failure) }]);

    const body = await (await routeRuntimeChat({ agentId: "claude-code", userId: "user-a", roomId: "room-a", userContent: "hi", mode: "coding_runtime" })).text();
    expect(body).toContain('"code":"MODEL_UNAVAILABLE"');
    expect(body).toContain('"requestedModel":"claude-opus-9"');
  });

  it("reports an unready runtime when the worker does not answer", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const adapter = getRuntimeAdapter("claude-code") as RemoteCliRuntimeAdapter;
    m.setResponder(() => [{ t: "error", error: serializeRuntimeError(new RuntimeError("worker down", "runtime_host_unavailable", 503)) }]);
    await expect(adapter.readiness(m.runtime as RuntimeInstance)).resolves.toEqual({ ready: false, reason: "runtime_host_unavailable" });
    await expect(adapter.health(m.runtime as RuntimeInstance)).resolves.toMatchObject({ ready: false, failureCode: "runtime_host_unavailable" });
  });

  it("refuses tool-gated sends, whose authorizer cannot leave this process", async () => {
    vi.stubEnv("NODE_ENV", "production");
    const adapter = getRuntimeAdapter("claude-code");
    const iterate = async () => { for await (const _ of adapter.send({ sessionId: "s", prompt: "p", userId: "u", authorizeTool: async () => ({ allow: true, reason: "" }) })) { /* drain */ } };
    await expect(iterate()).rejects.toThrowError(/orchestration-worker/);
    expect(m.jobs).toHaveLength(0);
  });
});

describe("orchestration-worker execution host", () => {
  const resolved: RuntimeInstance = { id: "runtime-claude-code", agentId: "claude-code", kind: "claude-code", transport: "process", executable: "/opt/runtime-bin/claude" };

  function host(adapter: Partial<AgentRuntimeAdapter>) {
    const replies: RuntimeCallReply[] = [];
    const resolveRuntime = vi.fn(async (id: string) => (id === resolved.id ? resolved : null));
    const run = (payload: Omit<RuntimeCallPayload, "callId">) => executeRuntimeCall({ callId: "c1", ...payload }, async (reply) => { replies.push(reply); }, {
      adapterFor: () => adapter as AgentRuntimeAdapter,
      resolveRuntime,
    });
    return { replies, run, resolveRuntime };
  }

  it("re-resolves the runtime by id and ignores any executable in the request", async () => {
    const health = vi.fn().mockResolvedValue({ ready: true });
    const { replies, run } = host({ health });
    await run({ kind: "claude-code", method: "health", args: [{ id: "runtime-claude-code", executable: "/bin/sh" }] });
    expect(health).not.toHaveBeenCalled();
    expect(replies.at(-1)).toMatchObject({ t: "error", error: { name: "RuntimeError", code: "invalid_runtime_call" } });

    await run({ kind: "claude-code", method: "health", args: ["runtime-claude-code"] });
    expect(health).toHaveBeenCalledWith(resolved);
  });

  it("rejects unknown kinds and methods, and a runtime of another kind", async () => {
    const { replies, run } = host({});
    await run({ kind: "hermes" as never, method: "health", args: ["runtime-claude-code"] });
    await run({ kind: "claude-code", method: "restart" as never, args: [] });
    await run({ kind: "codex", method: "readiness", args: ["runtime-claude-code"] });
    const errors = replies.filter((reply) => reply.t === "error");
    expect(errors).toHaveLength(3);
    expect(errors[2]).toMatchObject({ error: { code: "runtime_not_found" } });
  });

  it("rebuilds send input from known fields and streams every event", async () => {
    const send = vi.fn(async function* () { yield event(1, "a"); yield event(2, "b"); });
    const { replies, run } = host({ send });
    await run({ kind: "claude-code", method: "send", args: [{ sessionId: "s1", prompt: "go", userId: "u1", authorizeTool: "x", extra: true }] });
    expect(send).toHaveBeenCalledWith({ sessionId: "s1", prompt: "go", userId: "u1" });
    expect(replies.map((reply) => reply.t)).toEqual(["accepted", "event", "event", "result"]);
  });

  it("serializes errors so the app rebuilds the original class", async () => {
    const failure = new ModelUnavailableError("codex", "gpt-x", null, "unknown model");
    const send = vi.fn(async function* () { throw failure; });
    const { replies, run } = host({ send });
    await run({ kind: "codex", method: "send", args: [{ sessionId: "s1", prompt: "go", userId: "u1" }] });
    const reply = replies.at(-1);
    expect(reply?.t).toBe("error");
    const rebuilt = deserializeRuntimeError((reply as Extract<RuntimeCallReply, { t: "error" }>).error);
    expect(rebuilt).toBeInstanceOf(ModelUnavailableError);
    expect((rebuilt as ModelUnavailableError).toJSON()).toEqual(failure.toJSON());
    expect(deserializeRuntimeError(serializeRuntimeError(new RuntimeError("busy", "session_busy", 409)))).toMatchObject({ code: "session_busy", status: 409 });
  });
});
