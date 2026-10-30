import type { EffortLevel } from "@/lib/agents/model-policy";
import { RuntimeError } from "./errors";
import {
  deserializeRuntimeError, queueRuntimeCallTransport,
  type CliRuntimeKind, type RuntimeCallMethod, type RuntimeCallTransport,
} from "./remote-execution";
import type { RuntimeProcessRunner } from "./runner";
import type {
  AgentRuntimeAdapter, AgentSession, ResumeSessionInput, RuntimeActionResult, RuntimeCapabilities,
  RuntimeDiscovery, RuntimeEvent, RuntimeHealth, RuntimeInstance, RuntimeLogPage, RuntimeLogQuery,
  RuntimeReadiness, SendTaskInput, SessionQuery, StartSessionInput,
} from "./types";

function forbidden(): never {
  throw new RuntimeError("CLI runtimes do not execute in this process.", "runtime_host_unavailable", 503);
}

/**
 * Given to the local adapter that serves the database-only methods below, so a
 * code path that tries to start a CLI process here fails loudly instead.
 */
export const forbiddenProcessRunner: RuntimeProcessRunner = {
  run: async () => forbidden(),
  spawn: () => forbidden(),
  realpath: async () => forbidden(),
};

/**
 * A CLI runtime adapter whose process lives in orchestration-worker
 * (remote-execution.ts). Same interface, so routes, chat routing, voice and
 * orchestration do not change. Operations that run the CLI are sent to the
 * worker; session reads, logs and static capabilities are database reads and
 * are served here by the local adapter, which cannot spawn.
 *
 * Runtime instances cross the wire as an id only: the worker re-resolves the
 * executable and arguments from its own registry, never from the request.
 */
export class RemoteCliRuntimeAdapter implements AgentRuntimeAdapter {
  constructor(
    readonly kind: CliRuntimeKind,
    private readonly local: AgentRuntimeAdapter,
    private readonly transport: RuntimeCallTransport = queueRuntimeCallTransport,
  ) {}

  private async request<T>(method: RuntimeCallMethod, args: unknown[]): Promise<T> {
    for await (const reply of this.transport.call({ kind: this.kind, method, args })) {
      if (reply.t === "result") return reply.value as T;
      if (reply.t === "error") throw deserializeRuntimeError(reply.error);
    }
    throw new RuntimeError("The orchestration worker ended the request without a result.", "runtime_host_unavailable", 503);
  }

  async discover(): Promise<RuntimeDiscovery> {
    try {
      return await this.request<RuntimeDiscovery>("discover", []);
    } catch (error) {
      return { found: false, kind: this.kind, instances: [], reason: error instanceof Error ? error.message : "runtime_host_unavailable" };
    }
  }

  async health(runtime: RuntimeInstance): Promise<RuntimeHealth> {
    try {
      return await this.request<RuntimeHealth>("health", [runtime.id]);
    } catch (error) {
      return {
        installed: false, processRunning: false, reachable: false, authenticated: null,
        ready: false, busy: false, degraded: true,
        failureCode: "runtime_host_unavailable",
        message: error instanceof Error ? error.message : "The orchestration worker is unavailable",
        checkedAt: new Date().toISOString(),
      };
    }
  }

  async readiness(runtime: RuntimeInstance): Promise<RuntimeReadiness> {
    try {
      return await this.request<RuntimeReadiness>("readiness", [runtime.id]);
    } catch (error) {
      return { ready: false, reason: error instanceof RuntimeError ? error.code : "runtime_host_unavailable" };
    }
  }

  startSession(input: StartSessionInput) { return this.request<AgentSession>("startSession", [input]); }
  resumeSession(input: ResumeSessionInput) { return this.request<AgentSession>("resumeSession", [input]); }

  async *send(input: SendTaskInput): AsyncIterable<RuntimeEvent> {
    // A tool authorizer is a closure over this process; it cannot cross to the worker.
    if (input.authorizeTool) {
      throw new RuntimeError("Tool-gated sessions must be driven from orchestration-worker.", "runtime_host_unavailable", 503);
    }
    const args = [{ sessionId: input.sessionId, prompt: input.prompt, userId: input.userId }];
    for await (const reply of this.transport.call({ kind: this.kind, method: "send", args })) {
      if (reply.t === "event") yield reply.event;
      else if (reply.t === "error") throw deserializeRuntimeError(reply.error);
      else if (reply.t === "result") return;
    }
    throw new RuntimeError("The orchestration worker ended the task without completing it.", "runtime_host_unavailable", 503);
  }

  cancel(sessionId: string) { return this.request<RuntimeActionResult>("cancel", [sessionId]); }

  /** The installed CLI's effort catalog for each model, read on the worker where the CLI is. */
  effortOptions(runtime: RuntimeInstance, models: string[]) {
    return this.request<Record<string, EffortLevel[]>>("effortOptions", [runtime.id, models]);
  }

  getSession(sessionId: string) { return this.local.getSession(sessionId); }
  listSessions(query: SessionQuery) { return this.local.listSessions(query); }
  getLogs(query: RuntimeLogQuery): Promise<RuntimeLogPage> { return this.local.getLogs(query); }
  restart(runtimeId: string): Promise<RuntimeActionResult> { return this.local.restart(runtimeId); }
  reload(runtimeId: string): Promise<RuntimeActionResult> { return this.local.reload(runtimeId); }
  capabilities(runtime: RuntimeInstance): Promise<RuntimeCapabilities> { return this.local.capabilities(runtime); }
}
