import { afterEach, describe, expect, it } from "vitest";
import { hermesAuth, __test__ } from "./hermes";
import { compatibilityRuntime } from "./config";
import type { RuntimeSessionStore } from "./store";
import type { AgentSession, RuntimeEvent, RuntimeEventType, SessionQuery, StartSessionInput } from "./types";

const { AsyncQueue, handleFrame } = __test__;

/**
 * Nathan2's execution contract, pinned.
 *
 * Root cause this suite exists for: HERMES_NATHAN2_PASSWORD was set while
 * HERMES_NATHAN2_USERNAME was empty. hermesAuth() silently produced no
 * credentials, fell through to a session token the gateway does not know, and
 * every ws-ticket request came back 401 no_cookie — so Nathan2 looked reachable
 * but could never execute.
 */

const ENV_KEYS = ["HERMES_NATHAN2_USERNAME", "HERMES_NATHAN2_PASSWORD", "HERMES_NATHAN2_SESSION_TOKEN"] as const;
const saved = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
});

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string | undefined>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined) process.env[key] = value;
  }
}

class MemoryStore implements RuntimeSessionStore {
  sessions = new Map<string, AgentSession>();
  events: RuntimeEvent[] = [];
  private n = 0;
  async create(input: StartSessionInput, runtime: AgentSession["runtime"], agentId: string, workingDirectory?: string, externalSessionId?: string) {
    const now = new Date().toISOString();
    const session = { id: `s-${++this.n}`, runtime, runtimeInstanceId: input.runtimeId, agentId, userId: input.userId,
      ...(workingDirectory ? { workingDirectory } : {}), ...(externalSessionId ? { externalSessionId } : {}),
      status: "ready", startedAt: now, lastActivityAt: now, metadata: {} } as AgentSession;
    this.sessions.set(session.id, session);
    return session;
  }
  async get(id: string) { return this.sessions.get(id) ?? null; }
  async list(_query: SessionQuery) { return [...this.sessions.values()]; }
  async update(id: string, data: Record<string, unknown>) {
    const current = this.sessions.get(id) ?? ({ metadata: {} } as AgentSession);
    const next = { ...current, ...data, metadata: (data.metadata as Record<string, unknown>) ?? current.metadata } as AgentSession;
    this.sessions.set(id, next);
    return next;
  }
  async append(sessionId: string, type: RuntimeEventType, data: Record<string, unknown> = {}) {
    const event = { type, sessionId, sequence: this.events.length + 1, timestamp: new Date().toISOString(), data } as RuntimeEvent;
    this.events.push(event);
    return event;
  }
  async logs() { return { events: this.events, hasMore: false }; }
}

describe("Hermes Nathan2 authentication", () => {
  it("refuses a half-configured credential pair instead of silently degrading", () => {
    setEnv({ HERMES_NATHAN2_PASSWORD: "a-password" });
    expect(() => hermesAuth("hermes-nathan2")).toThrow(/must both be set or both be empty/);

    setEnv({ HERMES_NATHAN2_USERNAME: "mobileops" });
    expect(() => hermesAuth("hermes-nathan2")).toThrow(/must both be set or both be empty/);
  });

  it("treats a whitespace-only username as unset rather than as a credential", () => {
    setEnv({ HERMES_NATHAN2_USERNAME: "   ", HERMES_NATHAN2_PASSWORD: "a-password" });
    expect(() => hermesAuth("hermes-nathan2")).toThrow(/must both be set or both be empty/);
  });

  it("builds the password-login credentials once both halves are present", () => {
    setEnv({ HERMES_NATHAN2_USERNAME: "mobileops", HERMES_NATHAN2_PASSWORD: "a-password" });
    expect(hermesAuth("hermes-nathan2")).toEqual({ token: undefined, credentials: { username: "mobileops", password: "a-password" } });
  });

  it("never borrows Lisa's shared session token for Nathan2", () => {
    setEnv({});
    process.env.HERMES_SESSION_TOKEN = "lisa-only-token";
    expect(hermesAuth("hermes-nathan2").token).toBeUndefined();
    delete process.env.HERMES_SESSION_TOKEN;
  });

  it("allows an empty configuration so unauthenticated local runtimes still resolve", () => {
    setEnv({});
    expect(hermesAuth("hermes-nathan2")).toEqual({ token: undefined, credentials: undefined });
  });
});

describe("Hermes Nathan2 verification state", () => {
  it("is marked execution verified on the audited endpoint", () => {
    expect(compatibilityRuntime("hermes-nathan2")).toMatchObject({
      enabled: true,
      executionVerified: true,
      endpoint: "http://127.0.0.1:4864",
    });
  });
});

describe("Hermes Nathan2 result normalization", () => {
  // Mirrors the live run recorded in 20260914040000_verify_hermes_nathan2:
  // status frames, one assistant_delta carrying the text, then completed.
  it("normalizes a Hermes turn into Sentinel runtime events", async () => {
    const store = new MemoryStore();
    const session = await store.create({ runtimeId: "runtime-hermes-nathan2", userId: "u" }, "hermes", "hermes-nathan2");
    const queue = new AsyncQueue<RuntimeEvent>();

    await handleFrame(store, session.id, { session_id: "ext-1", type: "message.start", payload: {} }, queue);
    await handleFrame(store, session.id, { session_id: "ext-1", type: "message.delta", payload: { text: "READY" } }, queue);
    await handleFrame(store, session.id, { session_id: "ext-1", type: "message.complete", payload: {} }, queue);

    const types = store.events.map((event) => event.type);
    expect(types).toContain("assistant_delta");
    expect(types.at(0)).toBe("status");

    const delta = store.events.find((event) => event.type === "assistant_delta");
    expect(delta?.data).toMatchObject({ text: "READY" });
  });

  it("records the model and provider the runtime actually reported", async () => {
    const store = new MemoryStore();
    const session = await store.create({ runtimeId: "runtime-hermes-nathan2", userId: "u" }, "hermes", "hermes-nathan2");
    const queue = new AsyncQueue<RuntimeEvent>();

    await handleFrame(store, session.id, { session_id: "ext-1", type: "session.info", payload: { model: "deepseek/deepseek-v4.1-flash", provider: "openrouter" } }, queue);

    expect((await store.get(session.id))?.metadata).toMatchObject({
      actualModel: "deepseek/deepseek-v4.1-flash",
      provider: "openrouter",
    });
  });

  it("drops frames that arrive after a session was cancelled", async () => {
    const store = new MemoryStore();
    const session = await store.create({ runtimeId: "runtime-hermes-nathan2", userId: "u" }, "hermes", "hermes-nathan2");
    await store.update(session.id, { status: "cancelled" });
    const queue = new AsyncQueue<RuntimeEvent>();

    await handleFrame(store, session.id, { session_id: "ext-1", type: "message.delta", payload: { text: "late" } }, queue);

    expect(store.events).toHaveLength(0);
  });
});
