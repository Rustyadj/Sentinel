import { describe, expect, it } from "vitest";
import {
  decodeParticipantMetadata,
  encodeParticipantMetadata,
  liveKitRoomName,
  roomIdFromLiveKitRoomName,
} from "@/lib/voice/gateway";

describe("liveKitRoomName", () => {
  it("derives a deterministic room name from a roomId", () => {
    expect(liveKitRoomName("room-123")).toBe("sentinel-voice-room-123");
  });
});

describe("roomIdFromLiveKitRoomName", () => {
  it("inverts liveKitRoomName", () => {
    expect(roomIdFromLiveKitRoomName(liveKitRoomName("room-123"))).toBe("room-123");
  });

  it("returns null for a room name outside Sentinel's namespace", () => {
    expect(roomIdFromLiveKitRoomName("some-other-room")).toBeNull();
  });
});

describe("encodeParticipantMetadata / decodeParticipantMetadata", () => {
  it("round-trips a full context", () => {
    const ctx = { agentId: "hermes-lisa", roomId: "room-1", userId: "user-1", workspaceId: "ws-1" };
    expect(decodeParticipantMetadata(encodeParticipantMetadata(ctx))).toEqual(ctx);
  });

  it("round-trips without the optional workspaceId", () => {
    const ctx = { agentId: "hermes-lisa", roomId: "room-1", userId: "user-1" };
    expect(decodeParticipantMetadata(encodeParticipantMetadata(ctx))).toEqual(ctx);
  });

  it("returns null for missing/empty input", () => {
    expect(decodeParticipantMetadata(undefined)).toBeNull();
    expect(decodeParticipantMetadata(null)).toBeNull();
    expect(decodeParticipantMetadata("")).toBeNull();
  });

  it("returns null for malformed JSON", () => {
    expect(decodeParticipantMetadata("{not json")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(decodeParticipantMetadata(JSON.stringify({ agentId: "a" }))).toBeNull();
  });
});
