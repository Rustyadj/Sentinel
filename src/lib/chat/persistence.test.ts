import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ findRoom: vi.fn(), createMany: vi.fn(), emitEvent: vi.fn() }));
vi.mock("@/lib/db", () => ({
  db: { chatRoom: { findFirst: mocks.findRoom }, message: { createMany: mocks.createMany } },
}));
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
    expect(mocks.findRoom).toHaveBeenCalledWith(expect.objectContaining({
      where: { id: "room-a", userId: "user-a" },
    }));
    expect(mocks.createMany).toHaveBeenCalledWith({
      data: [
        { chatRoomId: "room-a", role: "user", content: "hello" },
        { chatRoomId: "room-a", role: "agent", agentId: "agent-a", content: "hi" },
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
