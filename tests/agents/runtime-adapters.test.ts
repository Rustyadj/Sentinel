import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { ClaudeCodeRuntimeAdapter } from "@/lib/agents/runtime/claude-code";
import { CodexRuntimeAdapter } from "@/lib/agents/runtime/codex";
import { HttpAgentRuntimeAdapter } from "@/lib/agents/runtime/http-adapter";
import { safeRuntimeEnvironment, type CommandResult, type RuntimeProcessRunner, type SpawnedRuntimeProcess } from "@/lib/agents/runtime/runner";
import { containsSensitiveRuntimeConfig } from "@/lib/agents/runtime/sensitive-config";
import type { RuntimeSessionStore } from "@/lib/agents/runtime/store";
import type { AgentSession, RuntimeEvent, RuntimeEventType, RuntimeInstance, SessionQuery, StartSessionInput } from "@/lib/agents/runtime/types";

class MemoryStore implements RuntimeSessionStore {
  sessions = new Map<string, AgentSession>();
  events = new Map<string, RuntimeEvent[]>();
  sequence = 0;

  async create(input: StartSessionInput, runtime: AgentSession["runtime"], agentId: string, workingDirectory?: string, externalSessionId?: string) {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: `session-${++this.sequence}`, runtime, runtimeInstanceId: input.runtimeId, agentId, userId: input.userId,
      ...(input.workspaceId ? { workspaceId: input.workspaceId } : {}), ...(input.projectId ? { projectId: input.projectId } : {}),
      ...(workingDirectory ? { workingDirectory } : {}), ...(externalSessionId ? { externalSessionId } : {}),
      status: "ready", startedAt: now, lastActivityAt: now, metadata: {},
    };
    this.sessions.set(session.id, session);
    return session;
  }
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async list(query: SessionQuery) {
    return [...this.sessions.values()].filter((session) =>
      (!query.runtimeId || session.runtimeInstanceId === query.runtimeId)
      && (!query.status || session.status === query.status));
  }
  async update(id: string, data: Partial<Pick<AgentSession, "status" | "externalSessionId" | "exitCode">> & { completedAt?: Date; cancelledAt?: Date; metadata?: Record<string, unknown> }) {
    const current = this.sessions.get(id)!;
    const next = {
      ...current, ...data,
      completedAt: data.completedAt instanceof Date ? data.completedAt.toISOString() : current.completedAt,
      cancelledAt: data.cancelledAt instanceof Date ? data.cancelledAt.toISOString() : current.cancelledAt,
      lastActivityAt: new Date().toISOString(),
    } as AgentSession;
    this.sessions.set(id, next); return next;
  }
  async append(sessionId: string, type: RuntimeEventType, data: Record<string, unknown> = {}) {
    const list = this.events.get(sessionId) ?? [];
    const event = { type, sessionId, sequence: list.length + 1, timestamp: new Date().toISOString(), data } as RuntimeEvent;
    list.push(event); this.events.set(sessionId, list); return event;
  }
  async logs(sessionId: string) { return { events: this.events.get(sessionId) ?? [], hasMore: false }; }
}

class FakeProcess extends EventEmitter {
  stdout = new PassThrough();
  stderr = new PassThrough();
  pid = 123;
  killed = false;
  kill = vi.fn(() => {
    if (!this.killed) {
      this.killed = true; this.stdout.end(); this.stderr.end(); queueMicrotask(() => this.emit("close", null, "SIGTERM"));
    }
    return true;
  });
}

class FakeRunner implements RuntimeProcessRunner {
  versionFound = true;
  authenticated = true;
  dockerRunning = true;
  paths: Record<string, string> = { "/allowed": "/allowed", "/allowed/repo": "/allowed/repo" };
  spawned: Array<{ executable: string; args: string[]; cwd?: string; process: FakeProcess }> = [];
  onSpawn?: (process: FakeProcess) => void;

  async run(_executable: string, args: string[]): Promise<CommandResult> {
    if (_executable === "docker" && args.includes("inspect")) {
      return { stdout: this.dockerRunning ? "true\n" : "false\n", stderr: "", exitCode: 0 };
    }
    if (args.includes("--version")) {
      if (!this.versionFound) throw Object.assign(new Error("ENOENT"), { code: "ENOENT" });
      return { stdout: "runtime 1.2.3\n", stderr: "", exitCode: 0 };
    }
    return { stdout: this.authenticated ? "authenticated" : "", stderr: this.authenticated ? "" : "login required", exitCode: this.authenticated ? 0 : 1 };
  }
  spawn(executable: string, args: string[], options: { cwd?: string }) {
    const process = new FakeProcess();
    this.spawned.push({ executable, args, cwd: options.cwd, process });
    this.onSpawn?.(process);
    return process as unknown as SpawnedRuntimeProcess;
  }
  async realpath(path: string) {
    const resolved = this.paths[path];
    if (!resolved) throw new Error("ENOENT");
    return resolved;
  }
}

const claudeRuntime: RuntimeInstance = {
  id: "runtime-claude-code", agentId: "claude-code", kind: "claude-code", transport: "process",
  executable: "claude", args: ["--permission-mode", "acceptEdits"], workingDirectoryRoot: "/allowed",
};
const codexRuntime: RuntimeInstance = {
  id: "runtime-codex", agentId: "codex", kind: "codex", transport: "process", executable: "codex",
  args: ["--sandbox", "workspace-write", "--ask-for-approval", "on-request"], workingDirectoryRoot: "/allowed",
};

async function collect(iterable: AsyncIterable<RuntimeEvent>) {
  const events: RuntimeEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("unified runtime discovery and readiness", () => {
  it("distinguishes binary present, binary absent, and unauthenticated", async () => {
    const runner = new FakeRunner(); const store = new MemoryStore();
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, store, runner);
    expect((await adapter.discover()).found).toBe(true);
    runner.authenticated = false;
    expect(await adapter.health(claudeRuntime)).toMatchObject({ installed: true, authenticated: false, ready: false, failureCode: "not_authenticated" });
    runner.versionFound = false;
    expect((await adapter.discover()).found).toBe(false);
    expect(await adapter.health(claudeRuntime)).toMatchObject({ installed: false, ready: false, failureCode: "binary_missing" });
  });

  it("reports unsupported Codex resume truthfully", async () => {
    const adapter = new CodexRuntimeAdapter(async () => codexRuntime, new MemoryStore(), new FakeRunner());
    await expect(adapter.resumeSession({ runtimeId: codexRuntime.id, externalSessionId: "thread-1", userId: "user-1" }))
      .rejects.toMatchObject({ code: "runtime_does_not_expose_capability" });
    expect(await adapter.capabilities(codexRuntime)).toMatchObject({ resume: false, streaming: true, cancel: true });
  });

  it("reports invalid CLI configuration and distinct HTTP process/API failures", async () => {
    const runner = new FakeRunner();
    const unconfigured = { ...claudeRuntime, executable: undefined };
    const cli = new ClaudeCodeRuntimeAdapter(async () => unconfigured, new MemoryStore(), runner);
    expect(await cli.health(unconfigured)).toMatchObject({ ready: false, failureCode: "configuration_invalid" });

    const httpRuntime: RuntimeInstance = {
      id: "runtime-hermes-lisa", agentId: "hermes-lisa", kind: "hermes", transport: "docker",
      endpoint: "http://runtime.invalid", containerName: "hermes-lisa",
    };
    const unreachable = new HttpAgentRuntimeAdapter(
      "hermes", async () => httpRuntime, new MemoryStore(), runner,
      vi.fn(async () => { throw new Error("ECONNREFUSED"); }) as unknown as typeof fetch,
    );
    expect(await unreachable.health(httpRuntime)).toMatchObject({ processRunning: true, reachable: false, failureCode: "api_unreachable" });
    runner.dockerRunning = false;
    expect(await unreachable.health(httpRuntime)).toMatchObject({ processRunning: false, reachable: false, message: "Runtime process is unavailable" });

    const unavailable = new HttpAgentRuntimeAdapter(
      "hermes", async () => httpRuntime, new MemoryStore(), runner,
      vi.fn(async () => new Response("down", { status: 503 })) as unknown as typeof fetch,
    );
    expect(await unavailable.health(httpRuntime)).toMatchObject({ reachable: false, failureCode: "provider_unavailable", message: "Runtime provider returned 503" });
  });

  it("supports Claude resume with a validated opaque provider session id", async () => {
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, new MemoryStore(), new FakeRunner());
    await expect(adapter.resumeSession({ runtimeId: claudeRuntime.id, externalSessionId: "provider-session-1", userId: "user-1" }))
      .resolves.toMatchObject({ externalSessionId: "provider-session-1", status: "ready" });
    await expect(adapter.resumeSession({ runtimeId: claudeRuntime.id, externalSessionId: "provider\n--unsafe", userId: "user-1" }))
      .rejects.toMatchObject({ code: "invalid_argument" });
  });

  it("surfaces a stale persisted session lock instead of reporting ready", async () => {
    const store = new MemoryStore();
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, store, new FakeRunner());
    const session = await adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/allowed/repo" });
    await store.update(session.id, { status: "running" });
    expect(await adapter.health(claudeRuntime)).toMatchObject({
      ready: false, busy: true, degraded: true, failureCode: "stale_session_lock", currentSessionId: session.id,
    });
  });
});

describe("CLI runtime execution and process cleanup", () => {
  it("creates a session, streams structured output, and completes", async () => {
    const runner = new FakeRunner(); const store = new MemoryStore();
    runner.onSpawn = (process) => setTimeout(() => {
      process.stdout.write(`${JSON.stringify({ type: "assistant", session_id: "provider-1", message: { content: [{ text: "done" }] } })}\n`);
      process.stdout.end(); process.stderr.end(); process.emit("close", 0, null);
    }, 0);
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, store, runner);
    const session = await adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workspaceId: "ws-1", workingDirectory: "/allowed/repo" });
    const events = await collect(adapter.send({ sessionId: session.id, prompt: "review this", userId: "user-1" }));
    expect(events.map((event) => event.type)).toContain("assistant_delta");
    expect(events.at(-1)?.type).toBe("completed");
    expect((await adapter.getSession(session.id))?.externalSessionId).toBe("provider-1");
    expect(runner.spawned[0]).toMatchObject({ executable: "claude", cwd: "/allowed/repo" });
  });

  it("marks non-zero exit as failed and retains stderr", async () => {
    const runner = new FakeRunner(); const store = new MemoryStore();
    runner.onSpawn = (process) => setTimeout(() => { process.stderr.write("provider failed\n"); process.stdout.end(); process.stderr.end(); process.emit("close", 7, null); }, 0);
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, store, runner);
    const session = await adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/allowed/repo" });
    const events = await collect(adapter.send({ sessionId: session.id, prompt: "run", userId: "user-1" }));
    expect(events.some((event) => event.type === "stderr" && event.data.text === "provider failed")).toBe(true);
    expect(events.at(-1)?.type).toBe("error");
    expect((await adapter.getSession(session.id))?.status).toBe("failed");
  });

  it("cancels an active process and cleans it from the active-session map", async () => {
    const runner = new FakeRunner(); const store = new MemoryStore();
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, store, runner);
    const session = await adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/allowed/repo" });
    const collecting = collect(adapter.send({ sessionId: session.id, prompt: "long task", userId: "user-1" }));
    await vi.waitFor(() => expect(runner.spawned).toHaveLength(1));
    expect(await adapter.cancel(session.id)).toMatchObject({ success: true });
    const events = await collecting;
    expect(events.at(-1)?.type).toBe("cancelled");
    expect((await adapter.getSession(session.id))?.status).toBe("cancelled");
  });

  it("times out and terminates a stuck process", async () => {
    const runner = new FakeRunner(); const store = new MemoryStore();
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, store, runner, 10);
    const session = await adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/allowed/repo" });
    const events = await collect(adapter.send({ sessionId: session.id, prompt: "hang", userId: "user-1" }));
    expect(runner.spawned[0].process.kill).toHaveBeenCalledWith("SIGTERM");
    expect(events.at(-1)?.data.reason).toBe("timeout");
    expect((await adapter.getSession(session.id))?.status).toBe("timed_out");
  });

  it("supports concurrent independent sessions but rejects a second task in one session", async () => {
    const runner = new FakeRunner(); const store = new MemoryStore();
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, store, runner);
    const one = await adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/allowed/repo" });
    const two = await adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/allowed/repo" });
    const first = collect(adapter.send({ sessionId: one.id, prompt: "one", userId: "user-1" }));
    const second = collect(adapter.send({ sessionId: two.id, prompt: "two", userId: "user-1" }));
    await vi.waitFor(() => expect(runner.spawned).toHaveLength(2));
    await expect(collect(adapter.send({ sessionId: one.id, prompt: "duplicate", userId: "user-1" }))).rejects.toMatchObject({ code: "session_busy" });
    await adapter.cancel(one.id); await adapter.cancel(two.id);
    await Promise.all([first, second]);
  });
});

describe("command and path injection resistance", () => {
  it("passes metacharacters, malicious branch text, and newlines as one opaque prompt argument without a shell", async () => {
    const runner = new FakeRunner(); const store = new MemoryStore();
    runner.onSpawn = (process) => setTimeout(() => { process.stdout.end(); process.stderr.end(); process.emit("close", 0, null); }, 0);
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, store, runner);
    const session = await adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/allowed/repo" });
    const prompt = "review branch --upload-pack='touch /tmp/pwned'; rm -rf /\n--permission-mode bypassPermissions";
    await collect(adapter.send({ sessionId: session.id, prompt, userId: "user-1" }));
    expect(runner.spawned[0].args.filter((argument) => argument === prompt)).toHaveLength(1);
    expect(runner.spawned[0].args).toContain("acceptEdits");
  });

  it("rejects traversal, newline paths, and symlink escapes", async () => {
    const runner = new FakeRunner(); const store = new MemoryStore();
    runner.paths["/allowed/link"] = "/outside/repository";
    runner.paths["/outside"] = "/outside";
    const adapter = new ClaudeCodeRuntimeAdapter(async () => claudeRuntime, store, runner);
    await expect(adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/allowed/link" })).rejects.toMatchObject({ code: "working_directory_not_allowed" });
    await expect(adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/allowed/repo\n--danger" })).rejects.toMatchObject({ code: "invalid_working_directory" });
    await expect(adapter.startSession({ runtimeId: claudeRuntime.id, userId: "user-1", workingDirectory: "/outside" })).rejects.toMatchObject({ code: "working_directory_not_allowed" });
  });

  it("does not forward database, provider, or arbitrary environment secrets", () => {
    process.env.DATABASE_URL = "secret-db"; process.env.ANTHROPIC_API_KEY = "secret-provider"; process.env.MALICIOUS = "injected";
    const environment = safeRuntimeEnvironment();
    expect(environment).not.toHaveProperty("DATABASE_URL");
    expect(environment).not.toHaveProperty("ANTHROPIC_API_KEY");
    expect(environment).not.toHaveProperty("MALICIOUS");
  });

  it("keeps credential-shaped runtime configuration out of the browser editor", () => {
    expect(containsSensitiveRuntimeConfig('{"apiKey":"secret"}')).toBe(true);
    expect(containsSensitiveRuntimeConfig("client_secret: secret")).toBe(true);
    expect(containsSensitiveRuntimeConfig("# Runtime behavior\nmode: safe")).toBe(false);
  });
});
