import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendSessionMemory: vi.fn(),
  captureAgentTurn: vi.fn(),
  persistChatExchange: vi.fn(),
  send: vi.fn(),
  writeAuditLog: vi.fn(),
  runtime: {
    id: "runtime-openclaw",
    agentId: "openclaw",
    kind: "openclaw",
    transport: "docker",
    workspaceId: "workspace-a",
    model: "deepseek/deepseek-v4-flash",
  },
}));

vi.mock("@/lib/db", () => ({
  db: {
    chatRoom: { findFirst: vi.fn().mockResolvedValue({ id: "room-a", projectId: "project-a" }) },
    agentSession: {
      findFirst: vi.fn().mockResolvedValue({
        id: "session-a",
        runtimeInstanceId: "runtime-hermes-lisa",
        userId: "user-a",
        chatRoomId: "room-a",
        status: "ready",
      }),
      update: vi.fn(),
    },
  },
}));
vi.mock("@/lib/chat/persistence", () => ({ persistChatExchange: mocks.persistChatExchange }));
vi.mock("@/lib/knowledge/retrieval", () => ({ appendSessionMemory: mocks.appendSessionMemory }));
vi.mock("@/lib/neural-engine/chat-capture", () => ({ captureAgentTurn: mocks.captureAgentTurn }));
vi.mock("@/lib/workspaces/audit", () => ({ writeAuditLog: mocks.writeAuditLog }));
vi.mock("@/lib/agents/runtime/authorization", () => ({
  RUNTIME_PERMISSIONS: { execute: "execute" },
  requireRuntimeAccess: vi.fn().mockResolvedValue({
    runtime: mocks.runtime,
  }),
  validateSessionScope: vi.fn(),
}));
vi.mock("@/lib/agents/runtime/service", () => ({
  getRuntimeAdapter: () => ({
    readiness: vi.fn().mockResolvedValue({ ready: true }),
    send: mocks.send,
  }),
}));
vi.mock("@/lib/agents/runtime/store", () => ({
  runtimeSessionStore: {
    update: vi.fn(),
    append: vi.fn(),
    get: vi.fn().mockResolvedValue({ metadata: { actualModel: "deepseek/deepseek-v4-flash" } }),
  },
}));
vi.mock("@/lib/agents/runtime/config", () => ({ asRuntimeInstance: (runtime: unknown) => runtime }));

import { routeRuntimeChat } from "@/lib/agents/runtime/chat-routing";

describe("runtime chat routing", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.appendSessionMemory.mockResolvedValue(undefined);
    mocks.captureAgentTurn.mockResolvedValue("experience-a");
    mocks.persistChatExchange.mockResolvedValue(undefined);
    mocks.writeAuditLog.mockResolvedValue(undefined);
    Object.assign(mocks.runtime, {
      id: "runtime-openclaw",
      agentId: "openclaw",
      kind: "openclaw",
      transport: "docker",
      workspaceId: "workspace-a",
      model: "deepseek/deepseek-v4-flash",
    });
    mocks.send.mockImplementation(async function* () {
      yield {
        type: "assistant_delta",
        sessionId: "session-a",
        sequence: 1,
        timestamp: new Date().toISOString(),
        data: { text: "native reply" },
      };
    });
  });

  it("runs persistence, shared session memory, neural capture, and graph notification", async () => {
    const response = await routeRuntimeChat({
      agentId: "hermes-lisa",
      userId: "user-a",
      roomId: "room-a",
      userContent: "hello",
      mode: "persistent_agent_runtime",
    });
    const body = await response.text();

    expect(mocks.persistChatExchange).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "room-a",
      agentId: "hermes-lisa",
      assistantContent: "native reply",
    }));
    expect(mocks.appendSessionMemory).toHaveBeenCalledWith("room-a", [
      { role: "user", content: "hello" },
      { role: "agent", content: "native reply" },
    ]);
    expect(mocks.captureAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "hermes-lisa",
      roomId: "room-a",
      userContent: "hello",
      fullContent: "native reply",
      model: "deepseek/deepseek-v4-flash",
    }));
    expect(body).toContain('"type":"knowledge_update","roomId":"room-a"');
  });

  it("forwards reported runtime token usage into neural capture", async () => {
    const { runtimeSessionStore } = await import("@/lib/agents/runtime/store");
    vi.mocked(runtimeSessionStore.get).mockResolvedValue({
      metadata: {
        actualModel: "gpt-6-astra",
        tokenUsage: {
          inputTokens: 1_000,
          outputTokens: 200,
          cachedInputTokens: 400,
          cacheWrite5mInputTokens: 100,
          cacheWrite1hInputTokens: 0,
        },
      },
    } as never);

    Object.assign(mocks.runtime, {
      id: "runtime-codex",
      agentId: "codex",
      kind: "codex",
      transport: "process",
      workspaceId: "workspace-a",
      model: "gpt-6-astra",
    });
    const response = await routeRuntimeChat({
      agentId: "codex",
      userId: "user-a",
      roomId: "room-a",
      userContent: "hello",
      mode: "coding_runtime",
    });
    await response.text();

    expect(mocks.captureAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      model: "gpt-6-astra",
      tokenUsage: {
        inputTokens: 1_000,
        outputTokens: 200,
        cachedInputTokens: 400,
        cacheWrite5mInputTokens: 100,
        cacheWrite1hInputTokens: 0,
      },
    }));
  });
});
