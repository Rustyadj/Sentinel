// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findRoom: vi.fn(),
  runTurn: vi.fn(),
  recordTurn: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db", () => ({ db: { chatRoom: { findFirst: mocks.findRoom } } }));
vi.mock("@/lib/voice/reasoning-bridge", () => ({ runVoiceReasoningTurn: mocks.runTurn }));
vi.mock("@/lib/voice/telemetry", () => ({ recordReasoningTurn: mocks.recordTurn }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/voice/reasoning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/voice/reasoning", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    mocks.findRoom.mockResolvedValue({ id: "room-1", agentIds: ["hermes-lisa"] });
    mocks.runTurn.mockResolvedValue({
      answer: "Three crews.",
      latencyMs: 812,
      toolCalls: 1,
      inputTokens: 100,
      outputTokens: 20,
      executedModel: "deepseek/deepseek-v4.1-flash",
    });
    mocks.recordTurn.mockResolvedValue(undefined);
  });

  it("requires a signed-in user", async () => {
    mocks.requireUser.mockResolvedValue(null);
    const response = await POST(request({ agentId: "hermes-lisa", request: "hi" }));
    expect(response.status).toBe(401);
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });

  it("answers Lisa's turn through her configured brain", async () => {
    const response = await POST(
      request({ agentId: "hermes-lisa", roomId: "room-1", request: "How many crews?" }),
    );
    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.answer).toBe("Three crews.");
    expect(payload.reasoningModel).toBe("deepseek/deepseek-v4.1-flash");
    expect(payload.agentId).toBe("hermes-lisa");
  });

  it("answers Nathan2's turn through his own, different brain", async () => {
    mocks.findRoom.mockResolvedValue({ id: "room-2", agentIds: ["hermes-nathan2"] });
    const response = await POST(
      request({ agentId: "hermes-nathan2", roomId: "room-2", request: "Status?" }),
    );
    expect(response.status).toBe(200);
    expect((await response.json()).reasoningModel).toBe("gpt-5.6-luna");
  });

  it("will not answer one agent's turn inside the other's conversation", async () => {
    // Lisa asking into Nathan2's room: the user owns it, but it is not hers.
    // This is the path by which private memory would bleed between them,
    // since the runtime loads conversation context from the room.
    mocks.findRoom.mockResolvedValue({ id: "room-2", agentIds: ["hermes-nathan2"] });
    const response = await POST(
      request({ agentId: "hermes-lisa", roomId: "room-2", request: "What did Nathan2 say?" }),
    );
    expect(response.status).toBe(403);
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });

  it("will not answer for an unnamed or unknown agent", async () => {
    for (const agentId of [undefined, "", "hermes-clint"]) {
      const response = await POST(request({ agentId, request: "hi" }));
      expect(response.status).toBe(400);
    }
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });

  it("records the turn's latency, tokens and tool calls", async () => {
    await POST(
      request({ agentId: "hermes-lisa", roomId: "room-1", request: "hi", sessionId: "tel-1" }),
    );
    expect(mocks.recordTurn).toHaveBeenCalledWith({
      sessionId: "tel-1",
      latencyMs: 812,
      inputTokens: 100,
      outputTokens: 20,
      toolCalls: 1,
    });
  });

  it("still answers when telemetry fails", async () => {
    mocks.recordTurn.mockRejectedValue(new Error("telemetry down"));
    const response = await POST(
      request({ agentId: "hermes-lisa", roomId: "room-1", request: "hi", sessionId: "tel-1" }),
    );
    // Measurement must never cost the user their answer.
    expect(response.status).toBe(200);
    expect((await response.json()).answer).toBe("Three crews.");
  });
});
