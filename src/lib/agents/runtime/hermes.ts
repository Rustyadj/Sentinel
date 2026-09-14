import { resolveEffectiveAgentModel, modelProvenance, sessionModelConfiguration, looksLikeModelUnavailable, ModelUnavailableError } from "@/lib/agents/model-policy";
import { RuntimeError } from "./errors";
import { HttpAgentRuntimeAdapter } from "./http-adapter";
import { runtimeSessionStore, type RuntimeSessionStore } from "./store";
import { HermesWebSocketClient, HermesWsError, type HermesEventFrame } from "./transports/hermes-websocket";
import type { RuntimeResolver } from "./cli-adapter";
import type {
  AgentRuntimeAdapter,
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

interface QueueItem<T> { value?: T; error?: Error; done?: boolean }

export function hermesAuth(agentId: string) {
  const prefix = agentId.replaceAll("-", "_").toUpperCase();
  const token = process.env[`${prefix}_SESSION_TOKEN`]?.trim() || (agentId === "hermes-lisa" ? process.env.HERMES_SESSION_TOKEN?.trim() : undefined);
  const username = process.env[`${prefix}_USERNAME`]?.trim();
  const password = process.env[`${prefix}_PASSWORD`]?.trim();
  // A half-configured credential pair is the failure that kept Nathan2 dark:
  // the password was set, the username was empty, so this silently produced no
  // credentials and fell through to a session token the gateway rejects with
  // 401 no_cookie. Refuse to start rather than degrade to an auth path the
  // operator did not choose.
  if (Boolean(username) !== Boolean(password)) {
    throw new RuntimeError(
      `${prefix}_USERNAME and ${prefix}_PASSWORD must both be set or both be empty; a half-configured credential pair cannot authenticate.`,
      "configuration_invalid",
      503,
    );
  }
  return { token, credentials: username && password ? { username, password } : undefined };
}
async function assertNoHermesFallback(client: HermesWebSocketClient, model: string, effort: import("@/lib/agents/model-policy").EffortLevel | null) {
  const { config } = await client.call<{ config: Record<string, unknown> }>("config.get", { key: "full" });
  const enabled = (value: unknown) => Array.isArray(value) ? value.length > 0 : value != null && value !== false && value !== "";
  if (!config || enabled(config.fallback_model) || enabled(config.fallback_providers)) {
    throw new ModelUnavailableError("hermes", model, effort, "Hermes fallback configuration must be empty; Sentinel never permits automatic model substitution");
  }
}

/** Bridges the WS client's event-callback model into an AsyncIterable for send(). */
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

/** Events that end a turn: send() stops iterating once one of these lands. */
const TERMINAL_EVENT_TYPES = new Set(["message.complete", "error"]);

/**
 * Real Hermes chat adapter. Verified live against `hermes-lisa` on
 * srv1427612.hstgr.cloud (docs/reviews/HERMES_OPENCLAW_CHAT_TRANSPORT.md):
 * `/api/ws?ticket=...` JSON-RPC over WebSocket, `session.create` /
 * `prompt.submit` / `session.interrupt` / `session.resume` RPCs, and the
 * `message.*` / `reasoning.*` / `thinking.*` / `tool.*` / `status.update` /
 * `error` event taxonomy.
 *
 * Non-chat capabilities (discover/health/logs/restart/reload) are unchanged
 * from before — Hermes exposes no HTTP surface for those, so they still go
 * through Docker inspect + the host-control service via the wrapped
 * HttpAgentRuntimeAdapter rather than being reimplemented here.
 */
export class HermesRuntimeAdapter implements AgentRuntimeAdapter {
  readonly kind = "hermes" as const;
  private readonly fallback: HttpAgentRuntimeAdapter;

  constructor(
    private readonly resolveRuntime: RuntimeResolver,
    private readonly store: RuntimeSessionStore = runtimeSessionStore,
  ) {
    this.fallback = new HttpAgentRuntimeAdapter("hermes", resolveRuntime);
  }

  discover(): Promise<RuntimeDiscovery> { return this.fallback.discover(); }
  async health(runtime: RuntimeInstance): Promise<RuntimeHealth> {
    const health = await this.fallback.health(runtime);
    if (!runtime.endpoint) return health;
    try {
      const client = await HermesWebSocketClient.connect(runtime.endpoint, fetch, 5000, hermesAuth(runtime.agentId).token, hermesAuth(runtime.agentId).credentials);
      client.close();
      return { ...health, installed: true, reachable: true, authenticated: true, ready: true, degraded: false, failureCode: undefined, message: undefined };
    } catch { return { ...health, authenticated: false, ready: false, degraded: true, failureCode: "hermes_auth_unavailable" }; }
  }
  async readiness(runtime: RuntimeInstance): Promise<RuntimeReadiness> { const health = await this.health(runtime); return { ready: health.ready, reason: health.failureCode }; }
  getLogs(query: RuntimeLogQuery): Promise<RuntimeLogPage> { return this.fallback.getLogs(query); }
  restart(runtimeId: string): Promise<RuntimeActionResult> { return this.fallback.restart(runtimeId); }
  reload(runtimeId: string): Promise<RuntimeActionResult> { return this.fallback.reload(runtimeId); }
  getSession(sessionId: string) { return this.store.get(sessionId); }
  listSessions(query: SessionQuery) { return this.store.list(query); }

  async capabilities(runtime: RuntimeInstance): Promise<RuntimeCapabilities> {
    void runtime;
    return {
      streaming: true, resume: true, cancel: true, toolEvents: true, fileChangeEvents: false,
      restart: { supported: true }, reload: { supported: true }, nativeUi: { supported: true },
    };
  }

  private async requireRuntime(id: string): Promise<RuntimeInstance> {
    const runtime = await this.resolveRuntime(id);
    if (!runtime || runtime.kind !== "hermes") throw new RuntimeError("Runtime not found", "runtime_not_found", 404);
    if (!runtime.endpoint) throw new RuntimeError("Hermes runtime has no HTTP endpoint configured", "configuration_invalid", 503);
    return runtime;
  }

  async startSession(input: StartSessionInput): Promise<AgentSession> {
    const runtime = await this.requireRuntime(input.runtimeId);
    const config = await resolveEffectiveAgentModel(runtime.agentId, "hermes", input.modelOverride);
    const client = await HermesWebSocketClient.connect(
      runtime.endpoint!,
      fetch,
      undefined,
      hermesAuth(runtime.agentId).token,
      hermesAuth(runtime.agentId).credentials,
    );
    try {
      await assertNoHermesFallback(client, config.runtimeModelId, config.effort);
      const result = await client.call<{ session_id: string; info?: { model?: string; provider?: string } }>("session.create", {
        cwd: input.workingDirectory,
        source: "sentinel",
        model: config.runtimeModelId,
        ...(config.effort ? { reasoning_effort: config.effort } : {}),
      });
      const session = await this.store.create(input, "hermes", runtime.agentId, input.workingDirectory, result.session_id);
      return this.store.update(session.id, { metadata: modelProvenance(runtime.agentId, "hermes", config) });
    } catch (err) {
      if (looksLikeModelUnavailable(String(err))) throw new ModelUnavailableError("hermes", config.runtimeModelId, config.effort, String(err));
      throw wrapHermesError(err);
    } finally {
      client.close();
    }
  }

  async resumeSession(input: ResumeSessionInput): Promise<AgentSession> {
    const runtime = await this.requireRuntime(input.runtimeId);
    const existing = await this.store.list({ runtimeId: input.runtimeId, userId: input.userId });
    const match = existing.find(s => s.userId === input.userId && s.externalSessionId === input.externalSessionId);
    if (!match || !sessionModelConfiguration(match.metadata)) throw new RuntimeError("Session not found", "session_not_found", 404);
    const client = await HermesWebSocketClient.connect(
      runtime.endpoint!,
      fetch,
      undefined,
      hermesAuth(runtime.agentId).token,
      hermesAuth(runtime.agentId).credentials,
    );
    try {
      await client.call("session.resume", { session_id: input.externalSessionId });
    } catch (err) {
      throw wrapHermesError(err);
    } finally {
      client.close();
    }
    return match;
  }

  async *send(input: SendTaskInput): AsyncIterable<RuntimeEvent> {
    const session = await this.store.get(input.sessionId);
    if (!session || session.userId !== input.userId) throw new RuntimeError("Session not found", "session_not_found", 404);
    if (activeConnections.has(session.id)) throw new RuntimeError("Session already has an active task", "session_busy", 409);
    if (!session.externalSessionId) throw new RuntimeError("Session has no Hermes session id", "session_not_ready", 409);
    const runtime = await this.requireRuntime(session.runtimeInstanceId);

    const client = await HermesWebSocketClient.connect(
      runtime.endpoint!,
      fetch,
      undefined,
      hermesAuth(runtime.agentId).token,
      hermesAuth(runtime.agentId).credentials,
    );
    const pinned = sessionModelConfiguration(session.metadata);
    if (!pinned) { client.close(); throw new RuntimeError("Session model provenance missing", "session_model_unknown", 409); }
    try { await assertNoHermesFallback(client, pinned.runtimeModelId, pinned.effort); } catch (error) { client.close(); throw error; }
    await this.store.update(session.id, { status: "running" });
    activeConnections.set(input.sessionId, client);

    // Hermes's own session dict is process-memory-bound and reaps sessions
    // whose owning WS transport has been disconnected past a grace window —
    // ordinary between-turn gaps on a per-turn connection like this one can
    // trip it (RPC error 4001 "session not found"), even though Sentinel's
    // own session row is perfectly healthy. `let` (not `const`) so a recovery
    // below can swap in a freshly minted Hermes session id.
    let externalSessionId = session.externalSessionId;

    const queue = new AsyncQueue<RuntimeEvent>();
    activeQueues.set(session.id, queue);
    const timeout = setTimeout(() => {
      void client.call("session.interrupt", { session_id: externalSessionId }).catch(() => undefined);
      void this.store.update(session.id, { status: "timed_out", completedAt: new Date() });
      queue.fail(new RuntimeError("Hermes turn timed out", "runtime_timeout", 503));
    }, 180_000);
    // handleFrame() does an async DB round-trip (store.append) to assign each
    // event's sequence number. Firing it unawaited per WS message let a later
    // frame's DB write occasionally resolve before an earlier one's, pushing
    // deltas onto the queue out of arrival order — the garbled/duplicated
    // streamed text bug. Chaining onto a single promise serializes handleFrame
    // calls so each one's queue.push happens strictly after the previous
    // frame's, regardless of DB latency variance.
    let frameChain: Promise<void> = Promise.resolve();
    const unsubscribe = client.onEvent((frame: HermesEventFrame) => {
      if (frame.session_id !== externalSessionId) return; // not our turn
      frameChain = frameChain.then(() => handleFrame(this.store, input.sessionId, frame, queue));
    });

    (async () => {
      try {
        let ack: { status: string };
        try {
          ack = await client.call<{ status: string }>("prompt.submit", {
            session_id: externalSessionId,
            text: input.prompt,
          });
        } catch (err) {
          if (!(err instanceof HermesWsError) || err.code !== 4001) throw err;
          // Hermes reaped the old session — mint a fresh one transparently
          // and persist it so the next turn starts from a live session too.
          const config = sessionModelConfiguration(session.metadata);
          if (!config) throw new RuntimeError("Cannot recover session without model provenance", "session_model_unknown", 409);
          const created = await client.call<{ session_id: string }>("session.create", {
            cwd: session.workingDirectory,
            source: "sentinel",
            model: config.runtimeModelId,
            ...(config.effort ? { reasoning_effort: config.effort } : {}),
          });
          externalSessionId = created.session_id;
          await this.store.update(input.sessionId, { externalSessionId });
          ack = await client.call<{ status: string }>("prompt.submit", {
            session_id: externalSessionId,
            text: input.prompt,
          });
        }
        if (ack.status !== "streaming") {
          queue.fail(new RuntimeError(`Unexpected prompt.submit ack: ${ack.status}`, "hermes_protocol_error", 503));
        }
      } catch (err) {
        await this.store.update(session.id, { status: "failed", completedAt: new Date() });
        queue.fail(looksLikeModelUnavailable(String(err)) ? new ModelUnavailableError("hermes", pinned.runtimeModelId, pinned.effort, String(err)) : wrapHermesError(err));
      }
    })();

    try {
      yield* queue;
    } finally {
      clearTimeout(timeout);
      activeQueues.delete(input.sessionId);
      unsubscribe();
      activeConnections.delete(input.sessionId);
      client.close();
    }
  }

  async cancel(sessionId: string): Promise<RuntimeActionResult> {
    const session = await this.store.get(sessionId);
    if (!session?.externalSessionId) return { success: false, message: "Session not found or not started" };
    const runtime = await this.requireRuntime(session.runtimeInstanceId);

    // Prefer interrupting over the live streaming connection if send() is
    // active right now; otherwise open a fresh one just to send the RPC.
    const live = activeConnections.get(sessionId);
    const client = live ?? await HermesWebSocketClient.connect(
      runtime.endpoint!,
      fetch,
      undefined,
      hermesAuth(runtime.agentId).token,
      hermesAuth(runtime.agentId).credentials,
    );
    try {
      await client.call("session.interrupt", { session_id: session.externalSessionId });
      await this.store.update(sessionId, { status: "cancelled", cancelledAt: new Date(), completedAt: new Date() });
      const queue = activeQueues.get(sessionId);
      if (queue) { queue.push(await this.store.append(sessionId, "cancelled", {})); queue.close(); }
      return { success: true };
    } catch (err) {
      return { success: false, message: err instanceof Error ? err.message : String(err) };
    } finally {
      if (!live) client.close();
    }
  }
}

// Tracks the WS connection a live send() is using, so cancel() can interrupt
// the same turn instead of racing a second connection against it.
const activeQueues = new Map<string, AsyncQueue<RuntimeEvent>>();
const activeConnections = new Map<string, HermesWebSocketClient>();

function wrapHermesError(err: unknown): Error {
  if (err instanceof HermesWsError) return new RuntimeError(err.message, "hermes_transport_error", 503);
  return err instanceof Error ? err : new Error(String(err));
}

/**
 * Normalizes one verified Hermes event frame into a persisted Sentinel
 * RuntimeEvent and pushes it onto the queue. Only user-visible message
 * deltas become assistant output. Private reasoning/thinking deltas are
 * reduced to status markers so raw chain-of-thought is neither persisted
 * nor streamed into chat content.
 */
async function handleFrame(store: RuntimeSessionStore, sessionId: string, frame: HermesEventFrame, queue: AsyncQueue<RuntimeEvent>) {
  try {
    const current = await store.get(sessionId);
    if (current?.status === "cancelled" || current?.status === "timed_out") return;
    const payload = frame.payload ?? {};
    if (typeof payload.model === "string" || typeof payload.provider === "string") {
      const session = await store.get(sessionId);
      await store.update(sessionId, { metadata: { ...session?.metadata,
        ...(typeof payload.model === "string" ? { actualModel: payload.model } : {}),
        ...(typeof payload.provider === "string" ? { provider: payload.provider } : {}),
        ...(typeof payload.reasoning_effort === "string" && payload.reasoning_effort !== "" ? { actualEffort: payload.reasoning_effort } : {}),
      } });
    }
    switch (frame.type) {
      case "message.start":
        queue.push(await store.append(sessionId, "status", { kind: "message_start", ...payload }));
        return;
      case "message.delta":
        queue.push(await store.append(sessionId, "assistant_delta", { kind: "message", ...payload }));
        return;
      case "reasoning.delta":
      case "thinking.delta":
        queue.push(await store.append(sessionId, "status", { kind: frame.type.split(".")[0] }));
        return;
      case "tool.start":
      case "tool.generating":
        queue.push(await store.append(sessionId, "tool_started", { phase: frame.type, ...payload }));
        return;
      case "tool.complete":
        queue.push(await store.append(sessionId, "tool_completed", payload));
        return;
      case "approval.request":
        queue.push(await store.append(sessionId, "approval_required", payload));
        return;
      case "status.update":
        queue.push(await store.append(sessionId, "status", payload));
        return;
      case "session.info":
        queue.push(await store.append(sessionId, "status", { kind: "session_info", ...payload }));
        return;
      case "error":
        {
          const session = await store.get(sessionId);
          const config = sessionModelConfiguration(session?.metadata ?? {});
          const unavailable = looksLikeModelUnavailable(JSON.stringify(payload));
          await store.update(sessionId, { status: "failed", completedAt: new Date(), metadata: { ...session?.metadata, modelUnavailable: unavailable } });
          queue.push(await store.append(sessionId, "error", { ...payload, ...(unavailable ? { code: "MODEL_UNAVAILABLE", runtime: "hermes", modelUnavailable: true, requestedModel: config?.runtimeModelId, requestedEffort: config?.effort, reason: JSON.stringify(payload) } : {}) }));
        }
        queue.close();
        return;
      case "message.complete":
        await store.update(sessionId, { status: "completed", completedAt: new Date() });
        queue.push(await store.append(sessionId, "completed", payload));
        queue.close();
        return;
      default:
        // Unrecognized event type — surface it as a low-severity status
        // rather than silently dropping it, so gaps in this taxonomy are
        // visible instead of invisible.
        queue.push(await store.append(sessionId, "status", { kind: `unhandled:${frame.type}`, ...payload }));
    }
  } catch (err) {
    queue.fail(err instanceof Error ? err : new Error(String(err)));
  }
}

export const __test__ = { AsyncQueue, handleFrame, TERMINAL_EVENT_TYPES };
