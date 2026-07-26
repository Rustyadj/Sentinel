import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// These tests exercise resolveUser()'s service-auth branch (used only by the
// LiveKit voice worker — see route.ts) through the real POST handler, using
// the "Agent not found" 404 as a stable checkpoint reached only after
// resolveUser() has already returned a user. Nothing past that point
// (streaming, persistence) is exercised or mocked.

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findRoom: vi.fn(),
  findUniqueUser: vi.fn(),
  findUniqueAgent: vi.fn(),
  getVpsAgent: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db", () => ({
  db: {
    chatRoom: { findFirst: mocks.findRoom },
    user: { findUnique: mocks.findUniqueUser },
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

const BASE_BODY = { messages: [{ role: "user", content: "hi" }], agentId: "unknown-agent" };

describe("POST /api/chat — resolveUser service-auth path", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.findUniqueAgent.mockResolvedValue(null);
    mocks.getVpsAgent.mockReturnValue(undefined);
  });
  afterEach(() => {
    delete process.env.VOICE_WORKER_SECRET;
  });

  it("falls back to the normal session when VOICE_WORKER_SECRET is unset", async () => {
    mocks.requireUser.mockRejectedValue(new Error("no session"));
    const response = await POST(request({ ...BASE_BODY, serviceUserId: "user-1" }, {
      authorization: "Bearer whatever",
    }));
    expect(response.status).toBe(401);
    expect(mocks.findUniqueUser).not.toHaveBeenCalled();
  });

  it("rejects a bearer token that doesn't match VOICE_WORKER_SECRET", async () => {
    process.env.VOICE_WORKER_SECRET = "correct-secret";
    mocks.requireUser.mockRejectedValue(new Error("no session"));
    const response = await POST(request({ ...BASE_BODY, serviceUserId: "user-1" }, {
      authorization: "Bearer wrong-secret",
    }));
    expect(response.status).toBe(401);
    expect(mocks.findUniqueUser).not.toHaveBeenCalled();
  });

  it("authenticates the voice worker with a matching secret + serviceUserId, routing into the same reasoning path", async () => {
    process.env.VOICE_WORKER_SECRET = "correct-secret";
    mocks.findUniqueUser.mockResolvedValue({ id: "user-1" });
    const response = await POST(request({ ...BASE_BODY, serviceUserId: "user-1" }, {
      authorization: "Bearer correct-secret",
    }));
    expect(mocks.findUniqueUser).toHaveBeenCalledWith({ where: { id: "user-1" }, select: { id: true } });
    expect(mocks.requireUser).not.toHaveBeenCalled();
    // Reaches the same "Agent not found" checkpoint a normal session user would.
    expect(response.status).toBe(404);
  });

  it("does not use the service-auth path when serviceUserId is absent, even with a matching secret", async () => {
    process.env.VOICE_WORKER_SECRET = "correct-secret";
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    const response = await POST(request(BASE_BODY, { authorization: "Bearer correct-secret" }));
    expect(mocks.findUniqueUser).not.toHaveBeenCalled();
    expect(mocks.requireUser).toHaveBeenCalled();
    expect(response.status).toBe(404);
  });
});
