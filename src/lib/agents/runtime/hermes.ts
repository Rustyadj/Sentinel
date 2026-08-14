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

function hermesSessionToken(): string | undefined {
  return process.env.HERMES_SESSION_TOKEN?.trim() || undefined;
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
  health(runtime: RuntimeInstance): Promise<RuntimeHealth> { return this.fallback.health(runtime); }
  readiness(runtime: RuntimeInstance): Promise<RuntimeReadiness> { return this.fallback.readiness(runtime); }
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
    const client = await HermesWebSocketClient.connect(
      runtime.endpoint!,
      fetch,
      undefined,
      hermesSessionToken(),
    );
    try {
      const result = await client.call<{ session_id: string }>("session.create", {
        cwd: input.workingDirectory,
        source: "sentinel",
      });
      return this.store.create(input, "hermes", runtime.agentId, input.workingDirectory, result.session_id);
    } catch (err) {
      throw wrapHermesError(err);
    } finally {
      client.close();
    }
  }

  async resumeSession(input: ResumeSessionInput): Promise<AgentSession> {
    const runtime = await this.requireRuntime(input.runtimeId);
    const client = await HermesWebSocketClient.connect(
      runtime.endpoint!,
      fetch,
      undefined,
      hermesSessionToken(),
    );
    try {
      await client.call("session.resume", { session_id: input.externalSessionId });
    } catch (err) {
      throw wrapHermesError(err);
    } finally {
      client.close();
    }
    const existing = await this.store.list({ runtimeId: input.runtimeId, userId: input.userId });
    const match = existing.find((s) => s.externalSessionId === input.externalSessionId);
    if (!match) throw new RuntimeError("Session not found", "session_not_found", 404);
    return match;
  }

  async *send(input: SendTaskInput): AsyncIterable<RuntimeEvent> {
    const session = await this.store.get(input.sessionId);
    if (!session) throw new RuntimeError("Session not found", "session_not_found", 404);
    if (!session.externalSessionId) throw new RuntimeError("Session has no Hermes session id", "session_not_ready", 409);
    const runtime = await this.requireRuntime(session.runtimeInstanceId);

    const client = await HermesWebSocketClient.connect(
      runtime.endpoint!,
      fetch,
      undefined,
      hermesSessionToken(),
    );
    activeConnections.set(input.sessionId, client);

    // Hermes's own session dict is process-memory-bound and reaps sessions
    // whose owning WS transport has been disconnected past a grace window —
    // ordinary between-turn gaps on a per-turn connection like this one can
    // trip it (RPC error 4001 "session not found"), even though Sentinel's
    // own session row is perfectly healthy. `let` (not `const`) so a recovery
    // below can swap in a freshly minted Hermes session id.
    let externalSessionId = session.externalSessionId;

    const queue = new AsyncQueue<RuntimeEvent>();
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
          const created = await client.call<{ session_id: string }>("session.create", {
            cwd: session.workingDirectory,
            source: "sentinel",
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
        queue.fail(wrapHermesError(err));
      }
    })();

    try {
      yield* queue;
    } finally {
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
      hermesSessionToken(),
    );
    try {
      await client.call("session.interrupt", { session_id: session.externalSessionId });
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
    const payload = frame.payload ?? {};
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
        queue.push(await store.append(sessionId, "error", payload));
        queue.close();
        return;
      case "message.complete":
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
