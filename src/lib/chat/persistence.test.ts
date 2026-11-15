import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findRoom: vi.fn(), createMany: vi.fn(), emitEvent: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { message: { createMany: mocks.createMany } },
}));
vi.mock("@/lib/orchestration/access", () => ({ requireRoomAccess: mocks.findRoom }));
vi.mock("@/lib/knowledge/events", () => ({ emitEvent: mocks.emitEvent }));

import { persistChatExchange } from "./persistence";

describe("chat persistence", () => {
  beforeEach(() => vi.clearAllMocks());

  it("persists both sides only after confirming room ownership", async () => {
    mocks.findRoom.mockResolvedValue({ id: "room-a", projectId: "project-a" });
    mocks.createMany.mockResolvedValue({ count: 2 });
    mocks.emitEvent.mockResolvedValue(undefined);
    await persistChatExchange({
      roomId: "room-a", userId: "user-a", userContent: "hello",
      agentId: "agent-a", assistantContent: "hi",
    });
    expect(mocks.findRoom).toHaveBeenCalledWith("room-a", "user-a");
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        { chatRoomId: "room-a", role: "user", content: "hello", authorUserId: "user-a" },
        {
          chatRoomId: "room-a",
          role: "agent",
          agentId: "agent-a",
          content: "hi",
          runtimeKind: undefined,
          provider: undefined,
          model: undefined,
          agentRuntimeSessionId: undefined,
        },
      ],
    });
  });

  it("persists assistant runtime provenance without putting it on the user message", async () => {
    mocks.findRoom.mockResolvedValue({ id: "room-a", projectId: "project-a" });
    mocks.createMany.mockResolvedValue({ count: 2 });
    mocks.emitEvent.mockResolvedValue(undefined);

    await persistChatExchange({
      roomId: "room-a",
      userId: "user-a",
      userContent: "run it",
      agentId: "codex",
      assistantContent: "done",
      provenance: {
        runtimeKind: "codex",
        provider: "openai",
        model: "gpt-5.6-codex",
        agentRuntimeSessionId: "session-a",
      },
    });

    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        { chatRoomId: "room-a", role: "user", content: "run it", authorUserId: "user-a" },
        expect.objectContaining({
          role: "agent",
          runtimeKind: "codex",
          provider: "openai",
          model: "gpt-5.6-codex",
          agentRuntimeSessionId: "session-a",
        }),
      ],
    });
  });

  it("rejects cross-user room persistence", async () => {
    mocks.findRoom.mockResolvedValue(null);
    await expect(persistChatExchange({
      roomId: "room-b", userId: "user-a", userContent: "secret",
      agentId: "agent-a", assistantContent: "nope",
    })).rejects.toThrow("Room not found");
    expect(mocks.createMany).not.toHaveBeenCalled();
  });
});
