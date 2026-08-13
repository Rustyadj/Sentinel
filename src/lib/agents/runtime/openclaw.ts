import { randomUUID } from "node:crypto";
import { assertSafeOpaqueId } from "./path-security";
import { RuntimeError } from "./errors";
import { HttpAgentRuntimeAdapter } from "./http-adapter";
import {
  loadOpenClawDeviceIdentity,
  OpenClawGatewayClient,
  openClawGatewayUrl,
  type OpenClawGatewayFrame,
} from "./openclaw-gateway";
import { nodeRuntimeProcessRunner, type RuntimeProcessRunner } from "./runner";
import { runtimeSessionStore, type RuntimeSessionStore } from "./store";
import type { RuntimeResolver } from "./cli-adapter";
import type {
  AgentSession,
  ResumeSessionInput,
  RuntimeActionResult,
  RuntimeCapabilities,
  RuntimeEvent,
  RuntimeInstance,
  RuntimeLogPage,
  RuntimeLogQuery,
  SendTaskInput,
  SessionQuery,
  StartSessionInput,
} from "./types";

interface QueueItem<T> { value?: T; done?: boolean }

class AsyncQueue<T> implements AsyncIterable<T> {
  private readonly items: QueueItem<T>[] = [];
  private readonly waiters: Array<(item: QueueItem<T>) => void> = [];

  push(value: T) { this.deliver({ value }); }
  close() { this.deliver({ done: true }); }

  private deliver(item: QueueItem<T>) {
    const waiter = this.waiters.shift();
    if (waiter) waiter(item); else this.items.push(item);
  }

  async *[Symbol.asyncIterator]() {
    while (true) {
      const item = this.items.shift() ?? await new Promise<QueueItem<T>>((resolve) => this.waiters.push(resolve));
      if (item.done) return;
      if (item.value) yield item.value;
    }
  }
}

interface ActiveOpenClawRun {
  client: OpenClawGatewayClientLike;
  sessionKey: string;
  runId?: string;
  cancelled: boolean;
}

export interface OpenClawGatewayClientLike {
  connect(): Promise<Record<string, unknown>>;
  onEvent(listener: (frame: OpenClawGatewayFrame) => void): () => void;
  request(
    method: string,
    params: Record<string, unknown>,
    options?: { expectFinal?: boolean; timeoutMs?: number; onAccepted?: (payload: Record<string, unknown>) => void },
  ): Promise<Record<string, unknown>>;
  close(): void;
}

export type OpenClawGatewayClientFactory = (runtime: RuntimeInstance) => Promise<OpenClawGatewayClientLike>;

export class OpenClawRuntimeAdapter extends HttpAgentRuntimeAdapter {
  declare readonly kind: "openclaw";
  private readonly active = new Map<string, ActiveOpenClawRun>();

  constructor(
    resolveRuntime: RuntimeResolver,
    private readonly sessionStore: RuntimeSessionStore = runtimeSessionStore,
    runner: RuntimeProcessRunner = nodeRuntimeProcessRunner,
    fetcher: typeof fetch = fetch,
    private readonly clientFactory: OpenClawGatewayClientFactory = defaultClientFactory,
  ) {
    super("openclaw", resolveRuntime, sessionStore, runner, fetcher);
    this.resolveOpenClawRuntime = resolveRuntime;
  }

  private readonly resolveOpenClawRuntime: RuntimeResolver;

  async health(runtime: RuntimeInstance) {
    const health = await super.health(runtime);
    if (!health.reachable) return health;
    try {
      await loadOpenClawDeviceIdentity(identityFilePath());
      return { ...health, authenticated: true, ready: true, degraded: false };
    } catch {
      return {
        ...health,
        authenticated: false,
        ready: false,
        degraded: true,
        failureCode: "not_authenticated",
        message: "Sentinel's OpenClaw device identity is unavailable or invalid",
      };
    }
  }

  async startSession(input: StartSessionInput): Promise<AgentSession> {
    const runtime = await this.requireOpenClawRuntime(input.runtimeId);
    const externalSessionId = randomUUID();
    const session = await this.sessionStore.create(input, this.kind, runtime.agentId, undefined, externalSessionId);
    await this.sessionStore.append(session.id, "session_started", {
      runtimeId: runtime.id,
      externalSessionId,
      transport: "openclaw_gateway_v4",
    });
    return session;
  }

  async resumeSession(input: ResumeSessionInput): Promise<AgentSession> {
    assertSafeOpaqueId(input.externalSessionId, "externalSessionId");
    const runtime = await this.requireOpenClawRuntime(input.runtimeId);
    const session = await this.sessionStore.create(input, this.kind, runtime.agentId, undefined, input.externalSessionId);
    await this.sessionStore.append(session.id, "session_started", {
      runtimeId: runtime.id,
      resumedFrom: input.externalSessionId,
      transport: "openclaw_gateway_v4",
    });
    return session;
  }

  async *send(input: SendTaskInput): AsyncGenerator<RuntimeEvent, void, unknown> {
    const session = await this.sessionStore.get(input.sessionId);
    if (!session || session.runtime !== this.kind || session.userId !== input.userId) {
      throw new RuntimeError("Session not found", "session_not_found", 404);
    }
    if (!input.prompt.trim() || input.prompt.includes("\0") || input.prompt.length > 100_000) {
      throw new RuntimeError("Prompt is invalid", "invalid_prompt", 400);
    }
    if (this.active.has(session.id)) throw new RuntimeError("Session already has an active task", "session_busy", 409);
    const runtime = await this.requireOpenClawRuntime(session.runtimeInstanceId);
    const externalSessionId = session.externalSessionId ?? randomUUID();
    const sessionKey = `agent:${openClawAgentId()}:explicit:${externalSessionId}`;
    const client = await this.clientFactory(runtime);
    const active: ActiveOpenClawRun = { client, sessionKey, cancelled: false };
    this.active.set(session.id, active);
    if (!session.externalSessionId) await this.sessionStore.update(session.id, { externalSessionId });
    await this.sessionStore.update(session.id, { status: "running" });

    const queue = new AsyncQueue<RuntimeEvent>();
    const emit = async (type: RuntimeEvent["type"], data: Record<string, unknown>) => {
      queue.push(await this.sessionStore.append(session.id, type, data));
    };

    void (async () => {
      let eventChain = Promise.resolve();
      let assistantDeltaSeen = false;
      const unsubscribe = client.onEvent((frame) => {
        eventChain = eventChain.then(async () => {
          const mapped = mapOpenClawEvent(frame, active, externalSessionId);
          if (!mapped) return;
          if (mapped.type === "assistant_delta") assistantDeltaSeen = true;
          await emit(mapped.type, mapped.data);
        });
      });
      try {
        await client.connect();
        const response = await client.request("agent", {
          message: input.prompt,
          agentId: openClawAgentId(),
          sessionId: externalSessionId,
          sessionKey,
          deliver: false,
          timeout: Math.ceil(openClawRequestTimeoutMs() / 1_000),
          cleanupBundleMcpOnRunEnd: true,
          idempotencyKey: randomUUID(),
        }, {
          expectFinal: true,
          timeoutMs: openClawRequestTimeoutMs(),
          onAccepted: (payload) => {
            const runId = typeof payload.runId === "string" ? payload.runId : undefined;
            if (runId) active.runId = runId;
            eventChain = eventChain.then(async () => {
              await this.sessionStore.update(session.id, {
                metadata: {
                  ...session.metadata,
                  runId,
                  sessionKey,
                  transport: "openclaw_gateway_v4",
                },
              });
              await emit("status", { phase: "accepted", runId, sessionKey });
            });
          },
        });
        await eventChain;
        if (active.cancelled) {
          await this.sessionStore.update(session.id, { status: "cancelled", cancelledAt: new Date(), completedAt: new Date() });
          await emit("cancelled", { runId: active.runId, sessionKey });
          return;
        }
        const result = asRecord(response.result);
        const payloads = Array.isArray(result.payloads) ? result.payloads : [];
        const finalText = payloads
          .map((payload) => typeof asRecord(payload).text === "string" ? asRecord(payload).text : "")
          .join("");
        if (!assistantDeltaSeen && finalText) await emit("assistant_delta", { text: finalText });
        const meta = asRecord(result.meta);
        const agentMeta = asRecord(meta.agentMeta);
        const executionTrace = asRecord(meta.executionTrace);
        await this.sessionStore.update(session.id, {
          status: "completed",
          completedAt: new Date(),
          metadata: {
            ...session.metadata,
            runId: active.runId,
            sessionKey,
            provider: agentMeta.provider,
            model: agentMeta.model,
            fallbackUsed: executionTrace.fallbackUsed === true,
            transport: "openclaw_gateway_v4",
          },
        });
        await emit("completed", {
          runId: active.runId,
          sessionKey,
          provider: agentMeta.provider,
          model: agentMeta.model,
          stopReason: meta.stopReason,
          fallbackUsed: executionTrace.fallbackUsed === true,
        });
      } catch (error) {
        await eventChain.catch(() => undefined);
        if (active.cancelled) {
          await this.sessionStore.update(session.id, { status: "cancelled", cancelledAt: new Date(), completedAt: new Date() }).catch(() => undefined);
          await emit("cancelled", { runId: active.runId, sessionKey }).catch(() => undefined);
        } else {
          const message = error instanceof Error ? error.message : "OpenClaw gateway request failed";
          await this.sessionStore.update(session.id, { status: "failed", completedAt: new Date() }).catch(() => undefined);
          await emit("error", { text: message, code: error instanceof RuntimeError ? error.code : "openclaw_gateway_error" }).catch(() => undefined);
        }
      } finally {
        unsubscribe();
        client.close();
        this.active.delete(session.id);
        queue.close();
      }
    })();

    yield* queue;
  }

  async cancel(sessionId: string): Promise<RuntimeActionResult> {
    const active = this.active.get(sessionId);
    if (!active) return { success: false, message: "Session has no active OpenClaw run" };
    active.cancelled = true;
    if (!active.runId) return { success: true, message: "Cancellation will be sent when OpenClaw accepts the run" };
    try {
      const response = await active.client.request("chat.abort", {
        sessionKey: active.sessionKey,
        runId: active.runId,
      }, { timeoutMs: 5_000 });
      return {
        success: response.aborted === true,
        message: response.aborted === true ? "OpenClaw cancellation confirmed" : "OpenClaw did not confirm cancellation",
      };
    } catch (error) {
      return { success: false, message: error instanceof Error ? error.message : "OpenClaw cancellation failed" };
    }
  }

  getSession(sessionId: string) { return this.sessionStore.get(sessionId); }
  listSessions(query: SessionQuery) { return this.sessionStore.list(query); }

  async getLogs(query: RuntimeLogQuery): Promise<RuntimeLogPage> {
    const { events, hasMore } = await this.sessionStore.logs(query.sessionId, query.since, query.limit);
    return {
      hasMore,
      lines: events.map((event) => JSON.stringify({ type: event.type, timestamp: event.timestamp, ...event.data })),
    };
  }

  async capabilities(): Promise<RuntimeCapabilities> {
    return {
      streaming: true,
      resume: true,
      cancel: true,
      toolEvents: true,
      fileChangeEvents: false,
      restart: { supported: true },
      reload: { supported: true },
      nativeUi: { supported: true },
    };
  }

  private async requireOpenClawRuntime(id: string) {
    const runtime = await this.resolveOpenClawRuntime(id);
    if (!runtime || runtime.kind !== this.kind) throw new RuntimeError("Runtime not found", "runtime_not_found", 404);
    return runtime;
  }
}

async function defaultClientFactory(runtime: RuntimeInstance) {
  const identity = await loadOpenClawDeviceIdentity(identityFilePath());
  return new OpenClawGatewayClient({
    url: openClawGatewayUrl(runtime.endpoint),
    identity,
    sharedToken: process.env.OPENCLAW_GATEWAY_TOKEN,
    requestTimeoutMs: openClawRequestTimeoutMs(),
  });
}

function mapOpenClawEvent(
  frame: OpenClawGatewayFrame,
  active: ActiveOpenClawRun,
  externalSessionId: string,
): { type: RuntimeEvent["type"]; data: Record<string, unknown> } | null {
  if (frame.event !== "agent") return null;
  const payload = frame.payload ?? {};
  const payloadRunId = typeof payload.runId === "string" ? payload.runId : undefined;
  const payloadSessionId = typeof payload.sessionId === "string" ? payload.sessionId : undefined;
  const payloadSessionKey = typeof payload.sessionKey === "string" ? payload.sessionKey : undefined;
  if (active.runId && payloadRunId && payloadRunId !== active.runId) return null;
  if (payloadSessionId && payloadSessionId !== externalSessionId) return null;
  if (payloadSessionKey && payloadSessionKey !== active.sessionKey) return null;
  const stream = typeof payload.stream === "string" ? payload.stream : "";
  const data = asRecord(payload.data);
  if (stream === "assistant" && typeof data.delta === "string" && data.delta) {
    return { type: "assistant_delta", data: { text: data.delta, runId: payloadRunId } };
  }
  if (stream === "tool") {
    const phase = typeof data.phase === "string" ? data.phase : "";
    return {
      type: phase === "result" || phase === "end" || phase === "completed" ? "tool_completed" : "tool_started",
      data: { event: data, runId: payloadRunId },
    };
  }
  if (stream === "lifecycle") {
    return { type: "status", data: { phase: data.phase, stopReason: data.stopReason, runId: payloadRunId } };
  }
  return null;
}

function identityFilePath() {
  return process.env.OPENCLAW_DEVICE_IDENTITY_FILE?.trim() || "/run/secrets/openclaw-device.json";
}

function openClawAgentId() {
  return process.env.OPENCLAW_AGENT_ID?.trim() || "main";
}

function openClawRequestTimeoutMs() {
  const configured = Number.parseInt(process.env.OPENCLAW_REQUEST_TIMEOUT_MS ?? "", 10);
  return Number.isFinite(configured) && configured >= 10_000 ? configured : 10 * 60_000;
}

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}
