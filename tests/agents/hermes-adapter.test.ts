import { describe, expect, it } from "vitest";
import { __test__ } from "@/lib/agents/runtime/hermes";
import type { RuntimeSessionStore } from "@/lib/agents/runtime/store";
import type { AgentSession, RuntimeEvent, RuntimeEventType, SessionQuery, StartSessionInput } from "@/lib/agents/runtime/types";

const { AsyncQueue, handleFrame } = __test__;

class MemoryStore implements RuntimeSessionStore {
  sessions = new Map<string, AgentSession>();
  events: RuntimeEvent[] = [];
  sequence = 0;

  async create(input: StartSessionInput, runtime: AgentSession["runtime"], agentId: string, workingDirectory?: string, externalSessionId?: string) {
    const now = new Date().toISOString();
    const session: AgentSession = {
      id: `session-${++this.sequence}`, runtime, runtimeInstanceId: input.runtimeId, agentId, userId: input.userId,
      ...(workingDirectory ? { workingDirectory } : {}), ...(externalSessionId ? { externalSessionId } : {}),
      status: "ready", startedAt: now, lastActivityAt: now, metadata: {},
    };
    this.sessions.set(session.id, session);
    return session;
  }
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async list(query: SessionQuery) {
    return [...this.sessions.values()].filter((s) => !query.runtimeId || s.runtimeInstanceId === query.runtimeId);
  }
  async update(id: string, data: Partial<Pick<AgentSession, "status" | "externalSessionId" | "exitCode">> & { completedAt?: Date; cancelledAt?: Date; metadata?: Record<string, unknown> }) {
    const current = this.sessions.get(id)!;
    const next: AgentSession = {
      ...current, ...data,
      completedAt: data.completedAt ? data.completedAt.toISOString() : current.completedAt,
      cancelledAt: data.cancelledAt ? data.cancelledAt.toISOString() : current.cancelledAt,
      metadata: data.metadata ?? current.metadata,
    };
    this.sessions.set(id, next);
    return next;
  }
  async append(sessionId: string, type: RuntimeEventType, data: Record<string, unknown> = {}) {
    const event: RuntimeEvent = { type, sessionId, sequence: this.events.length + 1, timestamp: new Date().toISOString(), data } as RuntimeEvent;
    this.events.push(event);
    return event;
  }
  async logs(sessionId: string) { return { events: this.events.filter((e) => e.sessionId === sessionId), hasMore: false }; }
}

async function drain(queue: InstanceType<typeof AsyncQueue<RuntimeEvent>>, count: number) {
  const out: RuntimeEvent[] = [];
  const it = queue[Symbol.asyncIterator]();
  for (let i = 0; i < count; i++) {
    const { value } = await it.next();
    out.push(value!);
  }
  return out;
}

describe("Hermes event normalization", () => {
  it("maps message.delta to assistant_delta and preserves payload", async () => {
    const store = new MemoryStore();
    const queue = new AsyncQueue<RuntimeEvent>();
    await handleFrame(store, "sess-1", { type: "message.delta", session_id: "hermes-sid", payload: { text: "hi" } }, queue);
    const [event] = await drain(queue, 1);
    expect(event.type).toBe("assistant_delta");
    expect(event.data).toMatchObject({ kind: "message", text: "hi" });
  });

  it("does not persist or stream raw reasoning and thinking text", async () => {
    const store = new MemoryStore();
    const queue = new AsyncQueue<RuntimeEvent>();
    await handleFrame(store, "sess-1", { type: "reasoning.delta", session_id: "hermes-sid", payload: { text: "r" } }, queue);
    await handleFrame(store, "sess-1", { type: "thinking.delta", session_id: "hermes-sid", payload: { text: "t" } }, queue);
    const [reasoning, thinking] = await drain(queue, 2);
    expect(reasoning.type).toBe("status");
    expect(reasoning.data.kind).toBe("reasoning");
    expect(reasoning.data.text).toBeUndefined();
    expect(thinking.type).toBe("status");
    expect(thinking.data.kind).toBe("thinking");
    expect(thinking.data.text).toBeUndefined();
  });

  it("maps tool.start/tool.complete to tool_started/tool_completed", async () => {
    const store = new MemoryStore();
    const queue = new AsyncQueue<RuntimeEvent>();
    await handleFrame(store, "sess-1", { type: "tool.start", session_id: "hermes-sid", payload: { name: "bash" } }, queue);
    await handleFrame(store, "sess-1", { type: "tool.complete", session_id: "hermes-sid", payload: { name: "bash", ok: true } }, queue);
    const [start, complete] = await drain(queue, 2);
    expect(start.type).toBe("tool_started");
    expect(complete.type).toBe("tool_completed");
    expect(complete.data).toMatchObject({ name: "bash", ok: true });
  });

  it("closes the queue on message.complete", async () => {
    const store = new MemoryStore();
    const queue = new AsyncQueue<RuntimeEvent>();
    await handleFrame(store, "sess-1", { type: "message.complete", session_id: "hermes-sid", payload: {} }, queue);
    const it = queue[Symbol.asyncIterator]();
    const first = await it.next(); // the "completed" event
    expect(first.value?.type).toBe("completed");
    const second = await it.next(); // queue.close() delivered right after
    expect(second.done).toBe(true);
  });

  it("closes the queue on error and surfaces it as an error event, not a thrown exception", async () => {
    const store = new MemoryStore();
    const queue = new AsyncQueue<RuntimeEvent>();
    await handleFrame(store, "sess-1", { type: "error", session_id: "hermes-sid", payload: { message: "boom" } }, queue);
    const [event] = await drain(queue, 1);
    expect(event.type).toBe("error");
    expect(event.data.message).toBe("boom");
  });

  it("surfaces unrecognized event types as a status event instead of silently dropping them", async () => {
    const store = new MemoryStore();
    const queue = new AsyncQueue<RuntimeEvent>();
    await handleFrame(store, "sess-1", { type: "some.future.event", session_id: "hermes-sid", payload: { x: 1 } }, queue);
    const [event] = await drain(queue, 1);
    expect(event.type).toBe("status");
    expect(event.data.kind).toBe("unhandled:some.future.event");
  });
});

describe("AsyncQueue", () => {
  it("delivers pushed values in FIFO order to a waiting consumer", async () => {
    const queue = new AsyncQueue<number>();
    const consumed: number[] = [];
    const consumer = (async () => {
      for await (const value of queue) consumed.push(value);
    })();
    queue.push(1);
    queue.push(2);
    queue.close();
    await consumer;
    expect(consumed).toEqual([1, 2]);
  });

  it("propagates fail() as a thrown error to the consumer", async () => {
    const queue = new AsyncQueue<number>();
    queue.fail(new Error("nope"));
    const it = queue[Symbol.asyncIterator]();
    await expect(it.next()).rejects.toThrow("nope");
  });
});
