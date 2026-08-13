import { describe, expect, it, vi } from "vitest";
import {
  OpenClawRuntimeAdapter,
  type OpenClawGatewayClientLike,
} from "@/lib/agents/runtime/openclaw";
import type { OpenClawGatewayFrame } from "@/lib/agents/runtime/openclaw-gateway";
import type { RuntimeSessionStore } from "@/lib/agents/runtime/store";
import type {
  AgentSession,
  RuntimeEvent,
  RuntimeEventType,
  RuntimeInstance,
  SessionQuery,
  StartSessionInput,
} from "@/lib/agents/runtime/types";

class MemoryStore implements RuntimeSessionStore {
  readonly sessions = new Map<string, AgentSession>();
  readonly events = new Map<string, RuntimeEvent[]>();
  private sequence = 0;

  async create(input: StartSessionInput, runtime: AgentSession["runtime"], agentId: string, workingDirectory?: string, externalSessionId?: string) {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: `session-${++this.sequence}`,
      runtime,
      runtimeInstanceId: input.runtimeId,
      agentId,
      userId: input.userId,
      status: "ready",
      startedAt: now,
      lastActivityAt: now,
      metadata: {},
      ...(workingDirectory ? { workingDirectory } : {}),
      ...(externalSessionId ? { externalSessionId } : {}),
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
    const { completedAt, cancelledAt, ...rest } = data;
    const next: AgentSession = {
      ...current,
      ...rest,
      ...(completedAt ? { completedAt: completedAt.toISOString() } : {}),
      ...(cancelledAt ? { cancelledAt: cancelledAt.toISOString() } : {}),
      lastActivityAt: new Date().toISOString(),
    };
    this.sessions.set(id, next);
    return next;
  }
  async append(sessionId: string, type: RuntimeEventType, data: Record<string, unknown> = {}) {
    const events = this.events.get(sessionId) ?? [];
    const event = {
      type,
      sessionId,
      sequence: events.length + 1,
      timestamp: new Date().toISOString(),
      data,
    } as RuntimeEvent;
    events.push(event);
    this.events.set(sessionId, events);
    return event;
  }
  async logs(sessionId: string) { return { events: this.events.get(sessionId) ?? [], hasMore: false }; }
}

class FakeGatewayClient implements OpenClawGatewayClientLike {
  listener?: (frame: OpenClawGatewayFrame) => void;
  readonly requests: Array<{ method: string; params: Record<string, unknown> }> = [];
  pendingAgent?: { resolve: (value: Record<string, unknown>) => void };
  holdAgent = false;

  async connect() { return { protocol: 4 }; }
  onEvent(listener: (frame: OpenClawGatewayFrame) => void) {
    this.listener = listener;
    return () => { this.listener = undefined; };
  }
  async request(
    method: string,
    params: Record<string, unknown>,
    options?: { onAccepted?: (payload: Record<string, unknown>) => void },
  ): Promise<Record<string, unknown>> {
    this.requests.push({ method, params });
    if (method === "chat.abort") return { aborted: true };
    const runId = "run-openclaw-1";
    options?.onAccepted?.({ status: "accepted", runId, sessionKey: params.sessionKey });
    const complete = () => {
      this.listener?.({
        type: "event",
        event: "agent",
        payload: {
          runId,
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          stream: "assistant",
          data: { text: "native reply", delta: "native reply" },
        },
      });
      this.listener?.({
        type: "event",
        event: "agent",
        payload: {
          runId,
          sessionId: params.sessionId,
          sessionKey: params.sessionKey,
          stream: "tool",
          data: { phase: "start", name: "memory_health_pg" },
        },
      });
      return {
        runId,
        status: "ok",
        result: {
          payloads: [{ text: "native reply" }],
          meta: {
            agentMeta: { provider: "openrouter", model: "deepseek/deepseek-v4-flash" },
            executionTrace: { fallbackUsed: false },
            stopReason: "stop",
          },
        },
      };
    };
    if (!this.holdAgent) return complete();
    return new Promise((resolve) => {
      this.pendingAgent = { resolve: () => resolve(complete()) };
    });
  }
  close() {}
}

const runtime: RuntimeInstance = {
  id: "runtime-openclaw",
  agentId: "openclaw",
  kind: "openclaw",
  transport: "docker",
  endpoint: "http://cash:18789/readyz",
  containerName: "openclaw-cash-cash-1",
};

async function collect(iterable: AsyncIterable<RuntimeEvent>) {
  const events: RuntimeEvent[] = [];
  for await (const event of iterable) events.push(event);
  return events;
}

describe("OpenClaw native gateway adapter", () => {
  it("streams native assistant and tool events and reuses the OpenClaw session", async () => {
    const store = new MemoryStore();
    const clients: FakeGatewayClient[] = [];
    const adapter = new OpenClawRuntimeAdapter(
      async () => runtime,
      store,
      undefined,
      undefined,
      async () => {
        const client = new FakeGatewayClient();
        clients.push(client);
        return client;
      },
    );
    const session = await adapter.startSession({ runtimeId: runtime.id, userId: "user-1" });
    const first = await collect(adapter.send({ sessionId: session.id, prompt: "first", userId: "user-1" }));
    const second = await collect(adapter.send({ sessionId: session.id, prompt: "second", userId: "user-1" }));

    expect(first.map((event) => event.type)).toEqual(expect.arrayContaining(["assistant_delta", "tool_started", "completed"]));
    expect(first.find((event) => event.type === "assistant_delta")?.data.text).toBe("native reply");
    expect((await adapter.getSession(session.id))?.status).toBe("completed");
    expect(clients[0].requests[0].method).toBe("agent");
    expect(clients[0].requests[0].params.sessionKey).toBe(clients[1].requests[0].params.sessionKey);
    expect(second.at(-1)?.data).toMatchObject({ provider: "openrouter", model: "deepseek/deepseek-v4-flash", fallbackUsed: false });
  });

  it("cancels an accepted run through chat.abort", async () => {
    const store = new MemoryStore();
    const client = new FakeGatewayClient();
    client.holdAgent = true;
    const adapter = new OpenClawRuntimeAdapter(async () => runtime, store, undefined, undefined, async () => client);
    const session = await adapter.startSession({ runtimeId: runtime.id, userId: "user-1" });
    const collecting = collect(adapter.send({ sessionId: session.id, prompt: "wait", userId: "user-1" }));
    await vi.waitFor(() => expect(client.pendingAgent).toBeDefined());
    await expect(adapter.cancel(session.id)).resolves.toMatchObject({ success: true });
    client.pendingAgent?.resolve({});
    const events = await collecting;

    expect(client.requests.some((request) => request.method === "chat.abort")).toBe(true);
    expect(events.at(-1)?.type).toBe("cancelled");
    expect((await adapter.getSession(session.id))?.status).toBe("cancelled");
  });
});
