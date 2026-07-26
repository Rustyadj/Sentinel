// @vitest-environment node
// jose (used by livekit-server-sdk's AccessToken) needs Node's real Uint8Array
// key-handling for HMAC signing; jsdom's polyfills break token signing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ requireUser: vi.fn(), findRoom: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db", () => ({ db: { chatRoom: { findFirst: mocks.findRoom } } }));

import { POST } from "./route";

function request(body: unknown) {
  return new Request("http://localhost/api/voice/token", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

const ENV_KEYS = ["LIVEKIT_URL", "LIVEKIT_API_KEY", "LIVEKIT_API_SECRET"] as const;

describe("POST /api/voice/token", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    process.env.LIVEKIT_URL = "wss://example.livekit.cloud";
    process.env.LIVEKIT_API_KEY = "test-key";
    process.env.LIVEKIT_API_SECRET = "test-secret-at-least-32-bytes-long";
  });
  afterEach(() => {
    for (const key of ENV_KEYS) delete process.env[key];
  });

  it("fails closed with 503 when LiveKit is not configured", async () => {
    delete process.env.LIVEKIT_URL;
    const response = await POST(request({ agentId: "hermes-lisa", roomId: "room-1" }));
    expect(response.status).toBe(503);
    expect(mocks.requireUser).not.toHaveBeenCalled();
  });

  it("rejects a missing agentId/roomId", async () => {
    const response = await POST(request({ agentId: "hermes-lisa" }));
    expect(response.status).toBe(400);
  });

  it("returns 401 when unauthenticated", async () => {
    mocks.requireUser.mockRejectedValue(new Error("no session"));
    const response = await POST(request({ agentId: "hermes-lisa", roomId: "room-1" }));
    expect(response.status).toBe(401);
  });

  it("returns 404 when the room isn't owned by the caller", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user-1", name: null, email: "u@example.com" });
    mocks.findRoom.mockResolvedValue(null);
    const response = await POST(request({ agentId: "hermes-lisa", roomId: "room-1" }));
    expect(response.status).toBe(404);
    expect(mocks.findRoom).toHaveBeenCalledWith({
      where: { id: "room-1", userId: "user-1" },
      select: { id: true },
    });
  });

  it("mints a real, scoped token for an owned room", async () => {
    mocks.requireUser.mockResolvedValue({ id: "user-1", name: "Rusty", email: "u@example.com" });
    mocks.findRoom.mockResolvedValue({ id: "room-1" });
    const response = await POST(request({ agentId: "hermes-lisa", roomId: "room-1" }));
    expect(response.status).toBe(200);
    const body = await response.json() as { url: string; token: string; room: string };
    expect(body.url).toBe("wss://example.livekit.cloud");
    expect(body.room).toBe("sentinel-voice-room-1");
    expect(body.token.split(".")).toHaveLength(3);

    const [, payloadB64] = body.token.split(".");
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString("utf8"));
    expect(payload.sub).toBe("user-1");
    expect(payload.video.room).toBe("sentinel-voice-room-1");
    expect(payload.video.roomJoin).toBe(true);
    const metadata = JSON.parse(payload.metadata);
    expect(metadata).toEqual({ agentId: "hermes-lisa", roomId: "room-1", userId: "user-1" });
  });
});
