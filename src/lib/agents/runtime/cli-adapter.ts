import { createInterface } from "node:readline";
import { ModelUnavailableError, isManagedWorkerKind, looksLikeAuthenticationRequired, looksLikeModelUnavailable, resolveEffectiveAgentModel, modelProvenance, sessionModelConfiguration, type WorkerModelConfig } from "@/lib/agents/model-policy";
import { isReportedTokenUsage } from "@/lib/agents/pricing";
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
  protected abstract buildTaskArgs(runtime: RuntimeInstance, prompt: string, externalSessionId?: string, modelConfig?: WorkerModelConfig): string[];
  protected abstract parseStructuredLine(line: string, sessionId: string): { type: RuntimeEvent["type"]; data: Record<string, unknown>; externalSessionId?: string };

  protected async reportedSessionModel(_externalSessionId: string, _startedAt: string): Promise<Record<string, unknown> | null> { return null; }

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
      const result = await this.runner.run(runtime.executable, this.versionArgs, { timeoutMs: 5_000 });
      if (result.exitCode !== 0) {
        return { found: false, kind: this.kind, instances: [], reason: result.stderr || "binary_unavailable" };
      }
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
    const config = await resolveEffectiveAgentModel(runtime.agentId, this.kind, input.modelOverride);
    const created = await this.store.create(input, this.kind, runtime.agentId, workingDirectory);
    const session = await this.store.update(created.id, { metadata: modelProvenance(runtime.agentId, this.kind, config) });
    await this.store.append(session.id, "session_started", { runtimeId: runtime.id, workingDirectory });
    return session;
  }

  async resumeSession(input: ResumeSessionInput): Promise<AgentSession> {
    if (!this.supportsResume) throw new UnsupportedRuntimeCapabilityError("resume");
    assertSafeOpaqueId(input.externalSessionId, "externalSessionId");
    const runtime = await this.requireRuntime(input.runtimeId);
    const workingDirectory = await resolveAllowedWorkingDirectory(this.runner, runtime.workingDirectoryRoot, undefined);
    const previous = (await this.store.list({ runtimeId: runtime.id, userId: input.userId })).find(s => s.externalSessionId === input.externalSessionId);
    if (!previous || !sessionModelConfiguration(previous.metadata)) throw new RuntimeError("Original session model provenance required for resume", "session_not_found", 404);
    const created = await this.store.create(input, this.kind, runtime.agentId, workingDirectory, input.externalSessionId);
    const session = await this.store.update(created.id, { metadata: previous.metadata });
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

    // Resolve the model/effort this execution requests, centrally, once —
    // never left to whatever the CLI's own ambient default happens to be.
    const modelConfig = isManagedWorkerKind(this.kind) ? sessionModelConfiguration(session.metadata) ?? await resolveEffectiveAgentModel(runtime.agentId, this.kind) : undefined;
    if (modelConfig && runtime.args?.some(arg => arg.startsWith("--fallback-model"))) throw new ModelUnavailableError(this.kind, modelConfig.runtimeModelId, modelConfig.effort, "Automatic fallback flags are forbidden; choose a model explicitly");
    const args = this.buildTaskArgs(runtime, input.prompt, session.externalSessionId, modelConfig);
    const child = this.runner.spawn(runtime.executable, args, { cwd: session.workingDirectory });
    const active: ActiveProcess = { child, cancelled: false, timedOut: false };
    this.active.set(session.id, active);
    await this.store.update(session.id, {
      status: "running",
      // Persist the requested model/effort on this execution's own record
      // (never inferred later from current global settings) so "which
      // model actually performed this?" has a real, auditable answer.
      ...(modelConfig ? { metadata: { ...modelProvenance(runtime.agentId, this.kind, modelConfig), ...session.metadata } } : {}),
    });
    const queue = new AsyncQueue<RuntimeEvent>();
    const emit = async (type: RuntimeEvent["type"], data: Record<string, unknown>) => queue.push(await this.store.append(session.id, type, data));
    let stderrBuffer = "";
    let structuredFailure = false;

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
            if (looksLikeModelUnavailable(line)) stderrBuffer += `${line}\n`;
            const parsed = this.parseStructuredLine(line, session.id);
            const event = parsed.data.event as Record<string, unknown> | undefined;
            if (event?.is_error === true || event?.type === "turn.failed") structuredFailure = true;
            const message = event?.message as Record<string, unknown> | undefined;
            // `parsed.data.actualModel` is the runtime-agnostic channel: an adapter that
            // knows where its runtime reports the model it really used sets it directly.
            // The `assistant`/`message.model` shape below is Claude Code's specific form.
            const actualModel = typeof parsed.data.actualModel === "string"
              ? parsed.data.actualModel
              : event?.type === "assistant" && typeof message?.model === "string" ? message.model : undefined;
            if (actualModel && !actualModel.startsWith("<")) {
              const latest = await this.store.get(session.id);
              await this.store.update(session.id, { metadata: { ...latest?.metadata, actualModel } });
            }
            if (isReportedTokenUsage(parsed.data.tokenUsage)) {
              const latest = await this.store.get(session.id);
              await this.store.update(session.id, { metadata: { ...latest?.metadata, tokenUsage: parsed.data.tokenUsage } });
            }
            if (parsed.externalSessionId && parsed.externalSessionId !== session.externalSessionId) {
              await this.store.update(session.id, { externalSessionId: parsed.externalSessionId });
            }
            await emit(parsed.type, parsed.data);
          }
        })();
        const readStderr = (async () => {
          for await (const line of stderr) {
            stderrBuffer += `${line}\n`;
            await emit("stderr", { text: line });
          }
        })();
        const exit = new Promise<{ code: number | null; signal: NodeJS.Signals | null }>((resolve, reject) => {
          child.once("error", reject);
          child.once("close", (code, signal) => resolve({ code, signal }));
        });
        const [{ code, signal }] = await Promise.all([exit, readStdout, readStderr]);
        clearTimeout(timeout);
        const status = active.cancelled ? "cancelled" : active.timedOut ? "timed_out" : code === 0 && !structuredFailure ? "completed" : "failed";
        // A failed run gets one extra check: did the runtime itself reject
        // the requested model, as opposed to an ordinary task failure? If
        // so this must be distinguishable downstream (agent-turn.ts throws
        // ModelUnavailableError from it) rather than treated like any other
        // failure — and Sentinel never reacts by silently trying another
        // model.
        const modelUnavailable = status === "failed" && Boolean(modelConfig) && looksLikeModelUnavailable(stderrBuffer);
        // An auth failure is not an ordinary task failure and is not fixed by
        // retrying or by picking another model: the operator must re-authenticate
        // the runtime. Classify it here so the surface above reports a clean
        // AUTH_REQUIRED state instead of leaking the provider's raw message
        // (e.g. "OAuth session expired and could not be refreshed"), which can
        // carry account identifiers or token fragments, into a chat transcript.
        const authRequired = status === "failed" && !modelUnavailable && looksLikeAuthenticationRequired(stderrBuffer);
        const latestSession = await this.store.get(session.id);
        const reported = status === "completed" && latestSession?.externalSessionId
          ? await this.reportedSessionModel(latestSession.externalSessionId, session.startedAt).catch(() => null) : null;
        await this.store.update(session.id, {
          status,
          exitCode: code ?? undefined,
          completedAt: new Date(),
          ...(active.cancelled ? { cancelledAt: new Date() } : {}),
          ...((modelUnavailable || authRequired || reported) ? { metadata: { ...(latestSession?.metadata ?? {}), ...reported, ...(modelUnavailable ? { modelUnavailable: true } : {}), ...(authRequired ? { authRequired: true } : {}) } } : {}),
        });
        await emit(status === "cancelled" ? "cancelled" : status === "completed" ? "completed" : "error", {
          exitCode: code,
          signal,
          ...(active.timedOut ? { reason: "timeout" } : {}),
          ...(modelUnavailable ? {
            code: "MODEL_UNAVAILABLE", runtime: this.kind, modelUnavailable: true,
            requestedModel: modelConfig?.runtimeModelId,
            requestedEffort: modelConfig?.effort,
            reason: stderrBuffer.slice(0, 2_000),
          } : {}),
          ...(authRequired ? {
            code: "AUTH_REQUIRED", runtime: this.kind, authRequired: true,
            // Deliberately a fixed operator-facing sentence, not provider stderr.
            message: `The ${this.kind} runtime is not authenticated. Re-authenticate it on the host, then retry.`,
          } : {}),
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
