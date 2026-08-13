import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  appendSessionMemory: vi.fn(),
  captureAgentTurn: vi.fn(),
  persistChatExchange: vi.fn(),
  send: vi.fn(),
  writeAuditLog: vi.fn(),
}));

vi.mock("@/lib/db", () => ({
  db: {
    chatRoom: { findFirst: vi.fn().mockResolvedValue({ id: "room-a", projectId: "project-a" }) },
    agentSession: {
      findFirst: vi.fn().mockResolvedValue({
        id: "session-a",
        runtimeInstanceId: "runtime-openclaw",
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
    runtime: {
      id: "runtime-openclaw",
      agentId: "openclaw",
      kind: "openclaw",
      transport: "docker",
      workspaceId: "workspace-a",
      model: "deepseek/deepseek-v4-flash",
    },
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
  runtimeSessionStore: { update: vi.fn(), append: vi.fn() },
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
      agentId: "openclaw",
      userId: "user-a",
      roomId: "room-a",
      userContent: "hello",
      mode: "persistent_agent_runtime",
    });
    const body = await response.text();

    expect(mocks.persistChatExchange).toHaveBeenCalledWith(expect.objectContaining({
      roomId: "room-a",
      agentId: "openclaw",
      assistantContent: "native reply",
    }));
    expect(mocks.appendSessionMemory).toHaveBeenCalledWith("room-a", [
      { role: "user", content: "hello" },
      { role: "agent", content: "native reply" },
    ]);
    expect(mocks.captureAgentTurn).toHaveBeenCalledWith(expect.objectContaining({
      agentId: "openclaw",
      roomId: "room-a",
      userContent: "hello",
      fullContent: "native reply",
      model: "deepseek/deepseek-v4-flash",
    }));
    expect(body).toContain('"type":"knowledge_update","roomId":"room-a"');
  });
});
