import { createInterface } from "node:readline";
import { RuntimeError, UnsupportedRuntimeCapabilityError } from "./errors";
import { assertSafeOpaqueId, resolveAllowedWorkingDirectory } from "./path-security";
import { nodeRuntimeProcessRunner, type RuntimeProcessRunner } from "./runner";
import type { SpawnedRuntimeProcess } from "./runner";
import { runtimeSessionStore, type RuntimeSessionStore } from "./store";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeKind,
  AgentSession,
  ResumeSessionInput,
  RuntimeActionResult,
  RuntimeCapabilities,
  RuntimeDiscovery,
  RuntimeEvent,
  RuntimeHealth,
  RuntimeInstance,
  RuntimeLogPage,
  RuntimeLogQuery,
  RuntimeReadiness,
  SendTaskInput,
  SessionQuery,
  StartSessionInput,
} from "./types";

export type RuntimeResolver = (id: string) => Promise<RuntimeInstance | null>;

interface ActiveProcess {
  child: SpawnedRuntimeProcess;
  cancelled: boolean;
  timedOut: boolean;
}

interface QueueItem<T> { value?: T; error?: Error; done?: boolean }

class AsyncQueue<T> implements AsyncIterable<T> {
  private items: QueueItem<T>[] = [];
  private waiters: Array<(item: QueueItem<T>) => void> = [];

  push(value: T) { this.deliver({ value }); }
  fail(error: Error) { this.deliver({ error }); }
  close() { this.deliver({ done: true }); }

  private deliver(item: QueueItem<T>) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item); else this.items.push(item);
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const item = this.items.shift() ?? await new Promise<QueueItem<T>>((resolve) => this.waiters.push(resolve));
      if (item.error) throw item.error;
      if (item.done) return;
      if (item.value) yield item.value;
    }
  }
}

export abstract class CliRuntimeAdapter implements AgentRuntimeAdapter {
  abstract readonly kind: AgentRuntimeKind;
  protected abstract readonly versionArgs: string[];
  protected abstract readonly authArgs: string[];
  protected abstract readonly supportsResume: boolean;
  protected abstract buildTaskArgs(runtime: RuntimeInstance, prompt: string, externalSessionId?: string): string[];
  protected abstract parseStructuredLine(line: string, sessionId: string): { type: RuntimeEvent["type"]; data: Record<string, unknown>; externalSessionId?: string };

  private readonly active = new Map<string, ActiveProcess>();

  constructor(
    protected readonly resolveRuntime: RuntimeResolver,
    protected readonly store: RuntimeSessionStore = runtimeSessionStore,
    protected readonly runner: RuntimeProcessRunner = nodeRuntimeProcessRunner,
    protected readonly timeoutMs = 10 * 60_000,
  ) {}

  async discover(): Promise<RuntimeDiscovery> {
    const runtime = await this.resolveRuntime(`runtime-${this.kind}`);
    if (!runtime?.executable) return { found: false, kind: this.kind, instances: [], reason: "configuration_invalid" };
    try {
      await this.runner.run(runtime.executable, this.versionArgs, { timeoutMs: 5_000 });
      return { found: true, kind: this.kind, instances: [runtime] };
    } catch (error) {
      return { found: false, kind: this.kind, instances: [], reason: error instanceof Error ? error.message : "binary_missing" };
    }
  }

  async health(runtime: RuntimeInstance): Promise<RuntimeHealth> {
    const checkedAt = new Date().toISOString();
    if (!runtime.executable) return unhealthy(checkedAt, "configuration_invalid", "No executable configured");
    let version: string | undefined;
    try {
      const result = await this.runner.run(runtime.executable, this.versionArgs, { timeoutMs: 5_000 });
      if (result.exitCode !== 0) return unhealthy(checkedAt, "binary_unavailable", result.stderr || "Version check failed");
      version = result.stdout.trim().split("\n")[0];
    } catch {
      return unhealthy(checkedAt, "binary_missing", "Runtime binary was not found");
    }

    let authenticated: boolean | null = null;
    try {
      const auth = await this.runner.run(runtime.executable, this.authArgs, { timeoutMs: 5_000 });
      authenticated = auth.exitCode === 0;
    } catch {
      authenticated = null;
    }
    const currentSessionId = [...this.active.keys()][0];
    const staleSession = currentSessionId
      ? undefined
      : (await this.store.list({ runtimeId: runtime.id, status: "running", limit: 1 }))[0];
    if (staleSession) {
      return {
        installed: true,
        processRunning: false,
        reachable: true,
        authenticated,
        ready: false,
        busy: true,
        degraded: true,
        version,
        currentSessionId: staleSession.id,
        failureCode: "stale_session_lock",
        message: "A persisted running session has no active runtime process",
        checkedAt,
      };
    }
    return {
      installed: true,
      processRunning: Boolean(currentSessionId),
      reachable: true,
      authenticated,
      ready: authenticated === true,
      busy: Boolean(currentSessionId),
      degraded: authenticated !== true,
      version,
      ...(currentSessionId ? { currentSessionId } : {}),
      ...(authenticated === false ? { failureCode: "not_authenticated", message: "Runtime requires provider authentication" } : {}),
      ...(authenticated === null ? { failureCode: "authentication_unknown", message: "Runtime authentication state could not be determined" } : {}),
      checkedAt,
    };
  }

  async readiness(runtime: RuntimeInstance): Promise<RuntimeReadiness> {
    const health = await this.health(runtime);
    return health.ready ? { ready: true } : { ready: false, reason: health.failureCode ?? health.message ?? "not_ready" };
  }

  async startSession(input: StartSessionInput): Promise<AgentSession> {
    const runtime = await this.requireRuntime(input.runtimeId);
    const workingDirectory = await resolveAllowedWorkingDirectory(this.runner, runtime.workingDirectoryRoot, input.workingDirectory);
    const session = await this.store.create(input, this.kind, runtime.agentId, workingDirectory);
    await this.store.append(session.id, "session_started", { runtimeId: runtime.id, workingDirectory });
    return session;
  }

  async resumeSession(input: ResumeSessionInput): Promise<AgentSession> {
    if (!this.supportsResume) throw new UnsupportedRuntimeCapabilityError("resume");
    assertSafeOpaqueId(input.externalSessionId, "externalSessionId");
    const runtime = await this.requireRuntime(input.runtimeId);
    const workingDirectory = await resolveAllowedWorkingDirectory(this.runner, runtime.workingDirectoryRoot, undefined);
    const session = await this.store.create(input, this.kind, runtime.agentId, workingDirectory, input.externalSessionId);
    await this.store.append(session.id, "session_started", { runtimeId: runtime.id, resumedFrom: input.externalSessionId });
    return session;
  }

  async *send(input: SendTaskInput): AsyncIterable<RuntimeEvent> {
    const session = await this.store.get(input.sessionId);
    if (!session || session.runtime !== this.kind) throw new RuntimeError("Session not found", "session_not_found", 404);
    if (session.userId !== input.userId) throw new RuntimeError("Session not found", "session_not_found", 404);
    if (!input.prompt.trim() || input.prompt.includes("\0") || input.prompt.length > 100_000) {
      throw new RuntimeError("Prompt is invalid", "invalid_prompt", 400);
    }
    if (this.active.has(session.id)) throw new RuntimeError("Session already has an active task", "session_busy", 409);
    const runtime = await this.requireRuntime(session.runtimeInstanceId);
    if (!runtime.executable || !session.workingDirectory) throw new RuntimeError("Runtime is not configured", "configuration_invalid", 503);

    const args = this.buildTaskArgs(runtime, input.prompt, session.externalSessionId);
    const child = this.runner.spawn(runtime.executable, args, { cwd: session.workingDirectory });
    const active: ActiveProcess = { child, cancelled: false, timedOut: false };
    this.active.set(session.id, active);
    await this.store.update(session.id, { status: "running" });
    const queue = new AsyncQueue<RuntimeEvent>();
    const emit = async (type: RuntimeEvent["type"], data: Record<string, unknown>) => queue.push(await this.store.append(session.id, type, data));

    const timeout = setTimeout(() => {
      active.timedOut = true;
      child.kill("SIGTERM");
      setTimeout(() => child.kill("SIGKILL"), 2_000).unref();
    }, this.timeoutMs);
    timeout.unref();

    void (async () => {
      try {
        const stdout = createInterface({ input: child.stdout, crlfDelay: Infinity });
        const stderr = createInterface({ input: child.stderr, crlfDelay: Infinity });
        const readStdout = (async () => {
          for await (const line of stdout) {
            const parsed = this.parseStructuredLine(line, session.id);
            if (parsed.externalSessionId && parsed.externalSessionId !== session.externalSessionId) {
              await this.store.update(session.id, { externalSessionId: parsed.externalSessionId });
            }
            await emit(parsed.type, parsed.data);
          }
        })();
        const readStderr = (async () => {
          for await (const line of stderr) await emit("stderr", { text: line });
        })();
        const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        });
        const [{ code, signal }] = await Promise.all([exit, readStdout, readStderr]);
        clearTimeout(timeout);
        const status = active.cancelled ? "cancelled" : active.timedOut ? "timed_out" : code === 0 ? "completed" : "failed";
        await this.store.update(session.id, {
          status,
          exitCode: code ?? undefined,
          completedAt: new Date(),
          ...(active.cancelled ? { cancelledAt: new Date() } : {}),
        });
        await emit(status === "cancelled" ? "cancelled" : status === "completed" ? "completed" : "error", {
          exitCode: code,
          signal,
          ...(active.timedOut ? { reason: "timeout" } : {}),
        });
        queue.close();
      } catch (error) {
        clearTimeout(timeout);
        await this.store.update(session.id, { status: "failed", completedAt: new Date() }).catch(() => undefined);
        queue.fail(error instanceof Error ? error : new Error("Runtime process failed"));
      } finally {
        this.active.delete(session.id);
      }
    })();

    yield* queue;
  }

  async cancel(sessionId: string): Promise<RuntimeActionResult> {
    const active = this.active.get(sessionId);
    if (!active) return { success: false, message: "Session has no active process" };
    active.cancelled = true;
    active.child.kill("SIGTERM");
    setTimeout(() => active.child.kill("SIGKILL"), 2_000).unref();
    return { success: true, message: "Cancellation requested" };
  }

  getSession(sessionId: string) { return this.store.get(sessionId); }
  listSessions(query: SessionQuery) { return this.store.list(query); }

  async getLogs(query: RuntimeLogQuery): Promise<RuntimeLogPage> {
    const { events, hasMore } = await this.store.logs(query.sessionId, query.since, query.limit);
    return {
      hasMore,
      lines: events.map((event) => JSON.stringify({ type: event.type, timestamp: event.timestamp, ...event.data })),
    };
  }

  async restart(): Promise<RuntimeActionResult> { throw new UnsupportedRuntimeCapabilityError("restart"); }
  async reload(): Promise<RuntimeActionResult> { throw new UnsupportedRuntimeCapabilityError("reload"); }

  abstract capabilities(runtime: RuntimeInstance): Promise<RuntimeCapabilities>;

  protected async requireRuntime(id: string) {
    const runtime = await this.resolveRuntime(id);
    if (!runtime || runtime.kind !== this.kind) throw new RuntimeError("Runtime not found", "runtime_not_found", 404);
    return runtime;
  }
}

function unhealthy(checkedAt: string, failureCode: string, message: string): RuntimeHealth {
  return {
    installed: false,
    processRunning: false,
    reachable: false,
    authenticated: null,
    ready: false,
    busy: false,
    degraded: true,
    failureCode,
    message,
    checkedAt,
  };
}
