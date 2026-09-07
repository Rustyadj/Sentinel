import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, afterEach } from "vitest";
import { ClaudeCodeRuntimeAdapter } from "./claude-code";
import { CodexRuntimeAdapter } from "./codex";
import type { RuntimeProcessRunner } from "./runner";
import type { RuntimeSessionStore } from "./store";
import type { AgentSession, RuntimeEvent, RuntimeEventType, RuntimeInstance, StartSessionInput } from "./types";

const ENV_KEYS = ["SENTINEL_CLAUDE_DEFAULT_MODEL", "SENTINEL_CLAUDE_DEFAULT_EFFORT", "SENTINEL_CODEX_DEFAULT_MODEL", "SENTINEL_CODEX_DEFAULT_EFFORT"] as const;
afterEach(() => { for (const key of ENV_KEYS) delete process.env[key]; });

function fakeChild(stdoutLines: string[], stderrLines: string[], exitCode: number) {
  const stdout = new PassThrough();
  const stderr = new PassThrough();
  const child = new EventEmitter() as EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: () => void };
  child.stdout = stdout;
  child.stderr = stderr;
  child.kill = () => undefined;
  queueMicrotask(() => {
    for (const line of stdoutLines) stdout.write(`${line}\n`);
    stdout.end();
    for (const line of stderrLines) stderr.write(`${line}\n`);
    stderr.end();
    setTimeout(() => child.emit("close", exitCode, null), 5);
  });
  return child;
}

class InMemoryStore implements RuntimeSessionStore {
  sessions = new Map<string, AgentSession>();
  seq = 0;

  async create(input: StartSessionInput, runtime: AgentSession["runtime"], agentId: string, workingDirectory?: string): Promise<AgentSession> {
    this.seq += 1;
    const session: AgentSession = {
      id: `session-${this.seq}`, runtime, runtimeInstanceId: input.runtimeId, agentId, userId: input.userId,
      workingDirectory, status: "created", startedAt: new Date().toISOString(), lastActivityAt: new Date().toISOString(),
      metadata: {},
    };
    this.sessions.set(session.id, session);
    return session;
  }

  async get(id: string) { return this.sessions.get(id) ?? null; }
  async list() { return [...this.sessions.values()]; }

  async update(id: string, data: Partial<Pick<AgentSession, "status" | "externalSessionId" | "exitCode">> & { completedAt?: Date; cancelledAt?: Date; metadata?: Record<string, unknown> }): Promise<AgentSession> {
    const existing = this.sessions.get(id)!;
    const { completedAt, cancelledAt, ...rest } = data;
    const updated: AgentSession = {
      ...existing, ...rest,
      ...(completedAt ? { completedAt: completedAt.toISOString() } : {}),
      ...(cancelledAt ? { cancelledAt: cancelledAt.toISOString() } : {}),
    };
    this.sessions.set(id, updated);
    return updated;
  }

  async append(sessionId: string, type: RuntimeEventType, data: Record<string, unknown> = {}): Promise<RuntimeEvent> {
    return { type, sessionId, sequence: 1, timestamp: new Date().toISOString(), data } as RuntimeEvent;
  }

  async logs() { return { events: [], hasMore: false }; }
}

function runtimeAt(kind: RuntimeInstance["kind"]): RuntimeInstance {
  return { id: "runtime-test", agentId: "test-agent", kind, transport: "process", executable: "fake-cli", workingDirectoryRoot: "/tmp" };
}

async function collectArgsAndRun(
  adapterFactory: (resolveRuntime: () => Promise<RuntimeInstance>, store: InMemoryStore, runner: RuntimeProcessRunner) => ClaudeCodeRuntimeAdapter | CodexRuntimeAdapter,
  stdoutLines: string[],
  stderrLines: string[],
  exitCode: number,
) {
  const store = new InMemoryStore();
  let capturedArgs: string[] = [];
  const runner: RuntimeProcessRunner = {
    run: async () => ({ exitCode: 0, stdout: "", stderr: "" }),
    spawn: (_executable, args) => {
      capturedArgs = args;
      return fakeChild(stdoutLines, stderrLines, exitCode) as unknown as ReturnType<RuntimeProcessRunner["spawn"]>;
    },
    realpath: async (path) => path,
  };
  let kind: RuntimeInstance["kind"] = "claude-code";
  const adapter = adapterFactory(async () => runtimeAt(kind), store, runner);
  kind = adapter.kind;
  const session = await store.create({ runtimeId: "runtime-test", userId: "u1" }, adapter.kind, "test-agent", "/tmp/session-cwd");

  const events: RuntimeEvent[] = [];
  for await (const event of adapter.send({ sessionId: session.id, prompt: "do the thing", userId: "u1" })) {
    events.push(event);
  }
  return { capturedArgs, events, finalSession: await store.get(session.id) };
}

describe("ClaudeCodeRuntimeAdapter — model policy wiring", () => {
  it("passes the resolved default model/effort as CLI flags", async () => {
    const { capturedArgs, finalSession } = await collectArgsAndRun(
      (resolveRuntime, store, runner) => new ClaudeCodeRuntimeAdapter(resolveRuntime, store, runner),
      [], [], 0,
    );
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs[capturedArgs.indexOf("--model") + 1]).toBe("claude-opus-5");
    expect(capturedArgs).toContain("--effort");
    expect(capturedArgs[capturedArgs.indexOf("--effort") + 1]).toBe("low");
    expect(finalSession?.metadata).toMatchObject({ requestedModel: "claude-opus-5", requestedEffort: "low" });
  });

  it("honors an env override for the runtime model id", async () => {
    process.env.SENTINEL_CLAUDE_DEFAULT_MODEL = "claude-sonnet-4-6";
    const { capturedArgs } = await collectArgsAndRun(
      (resolveRuntime, store, runner) => new ClaudeCodeRuntimeAdapter(resolveRuntime, store, runner),
      [], [], 0,
    );
    expect(capturedArgs[capturedArgs.indexOf("--model") + 1]).toBe("claude-sonnet-4-6");
  });

  it("flags a rejected model as MODEL_UNAVAILABLE without falling back to a different one", async () => {
    const { events, finalSession } = await collectArgsAndRun(
      (resolveRuntime, store, runner) => new ClaudeCodeRuntimeAdapter(resolveRuntime, store, runner),
      [], ["Error: model 'claude-opus-5' not found for this account"], 1,
    );
    const errorEvent = events.find((e) => e.type === "error")!;
    expect(errorEvent.data.modelUnavailable).toBe(true);
    expect(errorEvent.data.requestedModel).toBe("claude-opus-5");
    expect(finalSession?.status).toBe("failed");
    expect(finalSession?.metadata.modelUnavailable).toBe(true);
  });

  it("does not flag an ordinary failure unrelated to the model as MODEL_UNAVAILABLE", async () => {
    const { events } = await collectArgsAndRun(
      (resolveRuntime, store, runner) => new ClaudeCodeRuntimeAdapter(resolveRuntime, store, runner),
      [], ["Error: permission denied writing to /repo/file.ts"], 1,
    );
    const errorEvent = events.find((e) => e.type === "error")!;
    expect(errorEvent.data.modelUnavailable).toBeUndefined();
  });
});

describe("CodexRuntimeAdapter — model policy wiring", () => {
  it("passes the resolved default model/effort as CLI flags", async () => {
    const { capturedArgs } = await collectArgsAndRun(
      (resolveRuntime, store, runner) => new CodexRuntimeAdapter(resolveRuntime, store, runner),
      [], [], 0,
    );
    expect(capturedArgs).toContain("--model");
    expect(capturedArgs[capturedArgs.indexOf("--model") + 1]).toBe("gpt-6-astra");
    expect(capturedArgs.some((a) => a.includes("model_reasoning_effort") && a.includes("low"))).toBe(true);
  });
});

describe.skipIf(!process.env.DATABASE_URL)("persisted model drives the next execution", () => {
  it.each(["claude-code", "codex"] as const)("%s pins running/existing sessions and updates the next session's process arguments", async kind => {
    const { db } = await import("@/lib/db");
    const { randomUUID } = await import("node:crypto");
    const initialModel = kind === "codex" ? "gpt-6-astra" : "claude-opus-5";
    const nextModel = kind === "codex" ? "gpt-5.6-sol" : "claude-sonnet-5";
    const agent = await db.agent.create({ data: { id: randomUUID(), name: "Model process test", role: "assistant", avatar: "x", color: "#000000", model: initialModel, reasoningEffort: "low" } });
    try {
      const calls: string[][] = [];
      const runner: RuntimeProcessRunner = {
        run: async () => ({ exitCode: 0, stdout: "", stderr: "" }), realpath: async path => path,
        spawn: (_, args) => { calls.push(args); return fakeChild(['{"type":"status","model":"untrusted-init-label"}'], [], 0) as unknown as ReturnType<RuntimeProcessRunner["spawn"]>; },
      };
      const store = new InMemoryStore();
      const resolve = async () => ({ ...runtimeAt(kind), agentId: agent.id });
      const adapter = kind === "codex" ? new CodexRuntimeAdapter(resolve, store, runner) : new ClaudeCodeRuntimeAdapter(resolve, store, runner);
      const first = await adapter.startSession({ runtimeId: "runtime-test", userId: "u1" });
      for await (const event of adapter.send({ sessionId: first.id, userId: "u1", prompt: "first" })) {
        if (event.type === "stdout") {
          expect((await store.get(first.id))?.status).toBe("running");
          await db.agent.update({ where: { id: agent.id }, data: { model: nextModel, reasoningEffort: "high" } });
        }
      }
      for await (const _event of adapter.send({ sessionId: first.id, userId: "u1", prompt: "existing session" })) { /* drain */ }
      const next = await adapter.startSession({ runtimeId: "runtime-test", userId: "u1" });
      for await (const _event of adapter.send({ sessionId: next.id, userId: "u1", prompt: "new session" })) { /* drain */ }
      expect(calls.map(args => args[args.indexOf("--model") + 1])).toEqual([initialModel, initialModel, nextModel]);
      const efforts = calls.map(args => kind === "codex" ? args.find(arg => arg.startsWith("model_reasoning_effort=")) : args[args.indexOf("--effort") + 1]);
      expect(efforts).toEqual(kind === "codex" ? ['model_reasoning_effort="low"', 'model_reasoning_effort="low"', 'model_reasoning_effort="high"'] : ["low", "low", "high"]);
      expect((await store.get(first.id))?.metadata).toMatchObject({ requestedModel: initialModel, requestedEffort: "low", modelConfigSource: "agent" });
      expect((await store.get(first.id))?.metadata.actualModel).toBeUndefined();
      expect(calls).toHaveLength(3);
    } finally { await db.agent.delete({ where: { id: agent.id } }); }
  });
});
