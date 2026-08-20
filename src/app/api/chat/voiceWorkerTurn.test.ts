import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise resolveVoiceWorkerTurn()'s stateless-worker path
// through the real POST handler, using the "Agent not found" 404 as a
// stable checkpoint reached only after the turn has already been resolved
// to a user + agent. Nothing past that point (streaming, persistence) is
// exercised or mocked. The worker is intentionally never given an agentId
// or userId to choose from — Sentinel derives both from the room record.

const mocks = vi.hoisted(() => ({
  requireApiUser: vi.fn(),
  findRoom: vi.fn(),
  findUniqueRoom: vi.fn(),
  findUniqueAgent: vi.fn(),
  getVpsAgent: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ requireApiUser: mocks.requireApiUser }));
vi.mock("@/lib/db", () => ({
  db: {
    chatRoom: { findFirst: mocks.findRoom, findUnique: mocks.findUniqueRoom },
    agent: { findUnique: mocks.findUniqueAgent },
  },
}));
vi.mock("@/lib/agents/permissions", () => ({
  getControlPlaneUser: vi.fn(),
  requireAgentRecordUser: vi.fn(),
}));
vi.mock("@/lib/agents/registry", () => ({ getVpsAgent: mocks.getVpsAgent }));
vi.mock("@/lib/chat/persistence", () => ({ persistChatExchange: vi.fn() }));
vi.mock("@/lib/neural-engine/knowledge-bridge", () => ({ retrieveContextWithProvenance: vi.fn() }));
vi.mock("@/lib/neural-engine/chat-capture", () => ({ captureAgentTurn: vi.fn() }));
vi.mock("@/lib/neural-engine/retrieval-planner", () => ({ retrieve: vi.fn() }));

import { POST } from "./route";

function request(body: unknown, headers: Record<string, string> = {}) {
  return new Request("http://localhost/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...headers },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/chat — resolveVoiceWorkerTurn (stateless worker path)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUniqueAgent.mockResolvedValue(null);
    mocks.getVpsAgent.mockReturnValue(undefined);
  });
  afterEach(() => {
    delete process.env.VOICE_WORKER_SECRET;
  });

  it("falls back to the normal session when VOICE_WORKER_SECRET is unset", async () => {
    mocks.requireApiUser.mockRejectedValue(new Error("no session"));
    const response = await POST(request({ roomId: "room-1", userContent: "hi" }, {
      authorization: "Bearer whatever",
    }));
    expect(response.status).toBe(401);
    expect(mocks.findUniqueRoom).not.toHaveBeenCalled();
  });

  it("rejects a bearer token that doesn't match VOICE_WORKER_SECRET", async () => {
    process.env.VOICE_WORKER_SECRET = "correct-secret";
    mocks.requireApiUser.mockRejectedValue(new Error("no session"));
    const response = await POST(request({ roomId: "room-1", userContent: "hi" }, {
      authorization: "Bearer wrong-secret",
    }));
    expect(response.status).toBe(401);
    expect(mocks.findUniqueRoom).not.toHaveBeenCalled();
  });

  it("rejects a roomId with no owner (never trusts a caller-supplied userId)", async () => {
    process.env.VOICE_WORKER_SECRET = "correct-secret";
    mocks.requireApiUser.mockRejectedValue(new Error("no session"));
    mocks.findUniqueRoom.mockResolvedValue(null);
    const response = await POST(request({ roomId: "room-1", userContent: "hi" }, {
      authorization: "Bearer correct-secret",
    }));
    expect(response.status).toBe(401);
  });

  it("derives userId and agentId from the room record alone — the worker supplies neither", async () => {
    process.env.VOICE_WORKER_SECRET = "correct-secret";
    mocks.findUniqueRoom.mockResolvedValue({ userId: "user-1", agentIds: ["unknown-agent"] });
    const response = await POST(request({ roomId: "room-1", userContent: "hi" }, {
      authorization: "Bearer correct-secret",
    }));
    expect(mocks.findUniqueRoom).toHaveBeenCalledWith({
      where: { id: "room-1" },
      select: { userId: true, agentIds: true },
    });
    expect(mocks.requireApiUser).not.toHaveBeenCalled();
    // Reaches the same "Agent not found" checkpoint a normal session user would.
    expect(response.status).toBe(404);
  });

  it("defaults to hermes-lisa when the room has no agentIds", async () => {
    process.env.VOICE_WORKER_SECRET = "correct-secret";
    mocks.findUniqueRoom.mockResolvedValue({ userId: "user-1", agentIds: [] });
    mocks.getVpsAgent.mockReturnValue(undefined);
    const response = await POST(request({ roomId: "room-1", userContent: "hi" }, {
      authorization: "Bearer correct-secret",
    }));
    expect(response.status).toBe(404); // hermes-lisa isn't a real agent/VPS agent in this mock
  });

  it("requires userContent even with a valid worker secret and room", async () => {
    process.env.VOICE_WORKER_SECRET = "correct-secret";
    mocks.findUniqueRoom.mockResolvedValue({ userId: "user-1", agentIds: ["hermes-lisa"] });
    const response = await POST(request({ roomId: "room-1" }, {
      authorization: "Bearer correct-secret",
    }));
    expect(response.status).toBe(400);
  });
});
