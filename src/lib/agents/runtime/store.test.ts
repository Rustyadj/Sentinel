import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  aggregate: vi.fn(),
  create: vi.fn(),
  sessionUpdate: vi.fn(),
  sessionFindUnique: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    $transaction: async (fn: (tx: unknown) => unknown) =>
      fn({
        $executeRaw: async () => undefined,
        agentRuntimeEvent: { aggregate: mocks.aggregate, create: mocks.create },
        agentSession: { update: mocks.sessionUpdate },
      }),
    agentSession: { findUnique: mocks.sessionFindUnique },
  },
}));

import { PrismaRuntimeSessionStore } from "./store";

describe("PrismaRuntimeSessionStore.append — secret redaction on persist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.aggregate.mockResolvedValue({ _max: { sequence: 0 } });
    mocks.sessionUpdate.mockResolvedValue({});
    mocks.sessionFindUnique.mockResolvedValue({ id: "session-1", workspaceId: null, userId: "user-1", parentSessionId: null });
  });

  it("does not persist a secret-shaped fixture from mocked CLI stdout verbatim", async () => {
    const secretFixture = "SECRET_TOKEN=mysupersecretvalue123";
    mocks.create.mockImplementation(({ data }: { data: { payload: Record<string, unknown> } }) =>
      Promise.resolve({ type: "stdout", occurredAt: new Date(), payload: data.payload }),
    );

    const store = new PrismaRuntimeSessionStore();
    const event = await store.append("session-1", "stdout", { line: `$ cat .env\n${secretFixture}\nPORT=3000` });

    expect(mocks.create).toHaveBeenCalledTimes(1);
    const persistedPayload = mocks.create.mock.calls[0][0].data.payload as Record<string, unknown>;
    expect(JSON.stringify(persistedPayload)).not.toContain("mysupersecretvalue123");
    expect(persistedPayload.line).toContain("PORT=3000");

    // The returned RuntimeEvent (what callers stream back to chat transcripts
    // and the SSE response) must also be scrubbed, since it's built from the
    // same persisted row.
    expect(JSON.stringify(event.data)).not.toContain("mysupersecretvalue123");
  });

  it("leaves non-secret stdout untouched", async () => {
    mocks.create.mockImplementation(({ data }: { data: { payload: Record<string, unknown> } }) =>
      Promise.resolve({ type: "stdout", occurredAt: new Date(), payload: data.payload }),
    );
    const store = new PrismaRuntimeSessionStore();
    await store.append("session-1", "stdout", { line: "Running tests...\n12 passed" });
    const persistedPayload = mocks.create.mock.calls[0][0].data.payload as Record<string, unknown>;
    expect(persistedPayload.line).toBe("Running tests...\n12 passed");
  });
});
