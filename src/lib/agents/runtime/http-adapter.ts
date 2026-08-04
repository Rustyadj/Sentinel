import { readFile } from "node:fs/promises";
import { UnsupportedRuntimeCapabilityError, RuntimeError } from "./errors";
import { nodeRuntimeProcessRunner, type RuntimeProcessRunner } from "./runner";
import { runtimeSessionStore, type RuntimeSessionStore } from "./store";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeKind,
  AgentSession,
  RuntimeActionResult,
  RuntimeCapabilities,
  RuntimeDiscovery,
  RuntimeHealth,
  RuntimeInstance,
  RuntimeLogPage,
  RuntimeLogQuery,
  RuntimeReadiness,
  SessionQuery,
} from "./types";
import type { RuntimeResolver } from "./cli-adapter";

type Fetcher = typeof fetch;

export class HttpAgentRuntimeAdapter implements AgentRuntimeAdapter {
  constructor(
    readonly kind: Extract<AgentRuntimeKind, "hermes" | "openclaw">,
    private readonly resolveRuntime: RuntimeResolver,
    private readonly store: RuntimeSessionStore = runtimeSessionStore,
    private readonly runner: RuntimeProcessRunner = nodeRuntimeProcessRunner,
    private readonly fetcher: Fetcher = fetch,
  ) {}

  async discover(): Promise<RuntimeDiscovery> {
    const candidates = await Promise.all(
      [`runtime-${this.kind}`, ...(this.kind === "hermes" ? ["runtime-hermes-lisa"] : [])]
        .map((id) => this.resolveRuntime(id)),
    );
    const configured = candidates.filter((value): value is RuntimeInstance => Boolean(value && value.kind === this.kind));
    const probes = await Promise.all(configured.map(async (runtime) => ({ runtime, health: await this.health(runtime) })));
    const instances = probes.filter(({ health }) => health.installed || health.reachable).map(({ runtime }) => runtime);
    return { found: instances.length > 0, kind: this.kind, instances, ...(instances.length ? {} : { reason: "runtime_unavailable" }) };
  }

  async health(runtime: RuntimeInstance): Promise<RuntimeHealth> {
    const checkedAt = new Date().toISOString();
    let installed = false;
    let processRunning = false;
    if (runtime.containerName) {
      try {
        const result = await this.runner.run("docker", ["inspect", "--format", "{{.State.Running}}", runtime.containerName], { timeoutMs: 5_000 });
        installed = result.exitCode === 0;
        processRunning = result.exitCode === 0 && result.stdout.trim() === "true";
      } catch {
        processRunning = false;
      }
    }
    if (!runtime.endpoint) {
      return {
        installed, processRunning, reachable: false, authenticated: null,
        ready: false, busy: false, degraded: true, failureCode: "configuration_invalid",
        message: "No HTTP endpoint configured", checkedAt,
      };
    }
    try {
      const response = await this.fetcher(runtime.endpoint, { signal: AbortSignal.timeout(3_000) });
      const reachable = response.ok;
      const failure = response.status === 429
        ? { failureCode: "rate_limited", message: "Runtime endpoint is rate limited" }
        : response.status === 502 || response.status === 503 || response.status === 504
          ? { failureCode: "provider_unavailable", message: `Runtime provider returned ${response.status}` }
          : { failureCode: "api_unreachable", message: `Endpoint returned ${response.status}` };
      return {
        installed: installed || reachable, processRunning, reachable, authenticated: null,
        ready: reachable, busy: false, degraded: !reachable,
        ...(!reachable ? failure : {}),
        checkedAt,
      };
    } catch {
      return {
        installed, processRunning, reachable: false, authenticated: null,
        ready: false, busy: false, degraded: true, failureCode: "api_unreachable",
        message: processRunning ? "Process is running but its API is unreachable" : "Runtime process is unavailable",
        checkedAt,
      };
    }
  }

  async readiness(runtime: RuntimeInstance): Promise<RuntimeReadiness> {
    const health = await this.health(runtime);
    return health.ready ? { ready: true } : { ready: false, reason: health.failureCode ?? "not_ready" };
  }

  async startSession(): Promise<AgentSession> {
    throw new UnsupportedRuntimeCapabilityError("session_api_unverified");
  }
  async resumeSession(): Promise<AgentSession> {
    throw new UnsupportedRuntimeCapabilityError("resume");
  }
  async *send() { throw new UnsupportedRuntimeCapabilityError("send"); }
  async cancel(): Promise<RuntimeActionResult> { throw new UnsupportedRuntimeCapabilityError("cancel"); }
  getSession(sessionId: string) { return this.store.get(sessionId); }
  listSessions(query: SessionQuery) { return this.store.list(query); }

  async getLogs(query: RuntimeLogQuery): Promise<RuntimeLogPage> {
    const session = await this.store.get(query.sessionId);
    if (!session) throw new RuntimeError("Session not found", "session_not_found", 404);
    const runtime = await this.requireRuntime(session.runtimeInstanceId);
    const limit = Math.min(Math.max(query.limit ?? 200, 1), 500);
    if (runtime.logSource?.kind === "docker" && runtime.containerName) {
      const result = await this.runner.run("docker", ["logs", "--tail", String(limit), runtime.containerName], { timeoutMs: 8_000 });
      return { lines: `${result.stdout}\n${result.stderr}`.split("\n").filter(Boolean), hasMore: false };
    }
    if (runtime.logSource?.kind === "file") {
      const content = await readFile(runtime.logSource.ref, "utf8").catch(() => "");
      return { lines: content.split("\n").filter(Boolean).slice(-limit), hasMore: false };
    }
    return { lines: [], hasMore: false };
  }

  async restart(runtimeId: string) {
    const runtime = await this.requireRuntime(runtimeId);
    if (!runtime.containerName) throw new UnsupportedRuntimeCapabilityError("restart");
    const result = await this.runner.run("docker", ["restart", runtime.containerName], { timeoutMs: 30_000 });
    return { success: result.exitCode === 0, message: result.stderr || result.stdout };
  }

  async reload(runtimeId: string) {
    const runtime = await this.requireRuntime(runtimeId);
    if (!runtime.containerName) throw new UnsupportedRuntimeCapabilityError("reload");
    const result = await this.runner.run("docker", ["kill", "--signal=SIGHUP", runtime.containerName], { timeoutMs: 10_000 });
    return { success: result.exitCode === 0, message: result.stderr || result.stdout };
  }

  async capabilities(runtime: RuntimeInstance): Promise<RuntimeCapabilities> {
    void runtime;
    return {
      streaming: false, resume: false, cancel: false, toolEvents: false, fileChangeEvents: false,
      restart: { supported: true }, reload: { supported: true }, nativeUi: { supported: true },
    };
  }

  private async requireRuntime(id: string) {
    const runtime = await this.resolveRuntime(id);
    if (!runtime || runtime.kind !== this.kind) throw new RuntimeError("Runtime not found", "runtime_not_found", 404);
    return runtime;
  }
}
