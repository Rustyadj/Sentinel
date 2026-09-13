// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), findRoom: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db", () => ({ db: { chatRoom: { findFirst: mocks.findRoom } } }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/voice/openai/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

describe("POST /api/voice/openai/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-openai-key";
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    mocks.findRoom.mockResolvedValue({ id: "room-1" });
  });

  afterEach(() => {
    delete process.env.OPENAI_API_KEY;
    vi.unstubAllGlobals();
  });

  it("fails closed when the server key is missing", async () => {
    delete process.env.OPENAI_API_KEY;
    const response = await POST(request({ agentId: "hermes-lisa" }));
    expect(response.status).toBe(503);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("rejects unsupported agents", async () => {
    const response = await POST(request({ agentId: "openclaw" }));
    expect(response.status).toBe(400);
  });

  it("requires an owned room when roomId is supplied", async () => {
    mocks.findRoom.mockResolvedValue(null);
    const response = await POST(request({ agentId: "nathan2", roomId: "other-room" }));
    expect(response.status).toBe(404);
    expect(mocks.findRoom).toHaveBeenCalledWith({
      where: { id: "other-room", userId: "user-1" },
      select: { id: true },
    });
  });

  it("mints a mini session with GPT Live captions and a full-model escalation tool", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      value: "ek_test",
      expires_at: 1234,
    }), { status: 200, headers: { "Content-Type": "application/json" } }));
    vi.stubGlobal("fetch", fetchMock);

    const response = await POST(request({ agentId: "Nathan", roomId: "room-1" }));
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      clientSecret: "ek_test",
      model: "gpt-realtime-2.1-mini",
      escalationModel: "gpt-realtime-2.1",
      transcriptionModel: "gpt-live-transcribe",
      agentId: "nathan2",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const upstreamBody = JSON.parse(String(init.body));
    expect(upstreamBody.session.model).toBe("gpt-realtime-2.1-mini");
    expect(upstreamBody.session.audio.input.transcription.model).toBe("gpt-live-transcribe");
    expect(upstreamBody.session.tools[0].name).toBe("escalate_reasoning");
    expect(init.headers).not.toHaveProperty("OPENAI_API_KEY");
  });
});
