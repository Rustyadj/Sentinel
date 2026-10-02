// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findRoom: vi.fn(),
  startTelemetry: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db", () => ({ db: { chatRoom: { findFirst: mocks.findRoom } } }));
vi.mock("@/lib/voice/telemetry", () => ({ startVoiceSessionTelemetry: mocks.startTelemetry }));

import { POST } from "./route";

function request(body: Record<string, unknown>) {
  const withOffer = { sdp: "v=0 offer", ...body };
  return new Request("http://localhost/api/voice/openai/session", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(withOffer),
  }) as unknown as Parameters<typeof POST>[0];
}

/** Captures the session payload sent to the live voice provider. */
function stubProvider() {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(JSON.stringify({ session: { id: "live-1" }, transport: { type: "webrtc", sdp: "v=0 answer" } }), { status: 200 }),
  );
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sentSession(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string).session;
}

describe("POST /api/voice/openai/session", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.OPENAI_API_KEY = "test-openai-key";
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    mocks.findRoom.mockResolvedValue({ id: "room-1", agentIds: ["hermes-lisa"] });
    mocks.startTelemetry.mockResolvedValue("telemetry-1");
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

  it("refuses to pick an agent when none is named", async () => {
    // Previously an omitted agentId silently became Lisa.
    const response = await POST(request({}));
    expect(response.status).toBe(400);
  });

  it("opens Lisa's session with the Gleam voice and her own brain", async () => {
    const fetchMock = stubProvider();
    const response = await POST(request({ agentId: "hermes-lisa" }));
    expect(response.status).toBe(200);

    const session = sentSession(fetchMock);
    expect(session.audio.output.voice).toBe("gleam");
    expect(session.model).toBe("gpt-live-1");
    expect(session.instructions).toContain("Hermes Lisa");

    const payload = await response.json();
    expect(payload.reasoningModel).toBe("deepseek/deepseek-v4.1-flash");
    expect(payload.voice).toBe("gleam");
  });

  it("opens Nathan2's session with the Meridian voice and his own brain", async () => {
    mocks.findRoom.mockResolvedValue({ id: "room-2", agentIds: ["hermes-nathan2"] });
    const fetchMock = stubProvider();
    const response = await POST(request({ agentId: "hermes-nathan2", roomId: "room-2" }));
    expect(response.status).toBe(200);

    const session = sentSession(fetchMock);
    expect(session.audio.output.voice).toBe("meridian");
    expect(session.instructions).toContain("Hermes Nathan2");

    const payload = await response.json();
    expect(payload.reasoningModel).toBe("gpt-5.6-luna");
  });

  it("talks to GPT-Live, not the Realtime API, where gleam and meridian exist", async () => {
    const fetchMock = stubProvider();
    await POST(request({ agentId: "hermes-lisa" }));
    expect(fetchMock.mock.calls[0][0]).toBe("https://api.openai.com/v1/live/sessions");
  });

  it("gives the live layer no reasoning authority of its own", async () => {
    const fetchMock = stubProvider();
    await POST(request({ agentId: "hermes-lisa" }));
    const session = sentSession(fetchMock);
    // Client delegation: every substantive turn comes back to Sentinel, and
    // the live model is given no tools or backend model of its own.
    expect(session.delegation).toEqual({ type: "client" });
    expect(session.tools).toBeUndefined();
    expect(session.instructions).toMatch(/delegat/i);
  });

  it("forwards the browser's offer and returns the answer without exposing the key", async () => {
    const fetchMock = stubProvider();
    const response = await POST(request({ agentId: "hermes-lisa", sdp: "v=0 my-offer" }));
    const sent = JSON.parse(fetchMock.mock.calls[0][1].body as string);
    expect(sent.transport).toEqual({ type: "webrtc", sdp: "v=0 my-offer" });
    expect(fetchMock.mock.calls[0][1].headers.Authorization).toBe("Bearer test-openai-key");

    const text = await response.text();
    expect(JSON.parse(text).sdp).toBe("v=0 answer");
    expect(text).not.toContain("test-openai-key");
  });

  it("requires a WebRTC offer", async () => {
    const fetchMock = stubProvider();
    const response = await POST(request({ agentId: "hermes-lisa", sdp: "" }));
    expect(response.status).toBe(400);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces a provider rejection without leaking its internals", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ error: { message: "Invalid value: 'gleam'." } }), { status: 400 }),
    ));
    const response = await POST(request({ agentId: "hermes-lisa" }));
    expect(response.status).toBe(502);
    expect((await response.json()).error).toContain("Invalid value");
  });

  it("requires an owned room when roomId is supplied", async () => {
    mocks.findRoom.mockResolvedValue(null);
    const response = await POST(request({ agentId: "nathan2", roomId: "other-room" }));
    expect(response.status).toBe(404);
  });

  it("refuses to open one agent's voice inside the other's conversation", async () => {
    // The room belongs to the user, but it is Nathan2's conversation.
    mocks.findRoom.mockResolvedValue({ id: "room-2", agentIds: ["hermes-nathan2"] });
    const fetchMock = stubProvider();
    const response = await POST(request({ agentId: "hermes-lisa", roomId: "room-2" }));
    expect(response.status).toBe(403);
    // Refused before any session was minted, so no credential was issued for
    // a conversation this agent has no claim to.
    expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.startTelemetry).not.toHaveBeenCalled();
  });

  it("opens a telemetry session recording both models", async () => {
    stubProvider();
    await POST(request({ agentId: "hermes-nathan2", roomId: undefined }));
    expect(mocks.startTelemetry).toHaveBeenCalledWith(
      expect.objectContaining({
        agentId: "hermes-nathan2",
        voiceModel: "gpt-live-1",
        reasoningModel: "gpt-5.6-luna",
      }),
    );
  });
});
