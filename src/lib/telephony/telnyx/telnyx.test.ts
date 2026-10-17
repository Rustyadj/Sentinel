import { generateKeyPairSync, sign } from "node:crypto";
import { beforeEach, describe, expect, it, vi } from "vitest";

const redis = vi.hoisted(() => ({
  store: new Map<string, string>(),
}));
vi.mock("@/lib/redis", () => ({
  redisAcquireLease: async (k: string, v: string) => (redis.store.has(k) ? false : (redis.store.set(k, v), true)),
  redisGet: async (k: string) => redis.store.get(k) ?? null,
  redisSet: async (k: string, v: string) => void redis.store.set(k, v),
  redisDel: async (k: string) => void redis.store.delete(k),
}));
vi.mock("@/lib/voice/reasoning-bridge", () => ({
  runVoiceReasoningTurn: vi.fn(async () => ({ answer: "hello back", toolCalls: 0, latencyMs: 1 })),
}));
vi.mock("@/lib/workspaces/audit", () => ({ writeAuditLog: vi.fn(async () => ({})) }));
vi.mock("@/lib/db", () => ({
  db: {
    phoneMessage: { create: vi.fn(async () => ({})), updateMany: vi.fn(async () => ({})) },
    phoneCall: { findUnique: vi.fn(async () => null), updateMany: vi.fn(async () => ({})), count: vi.fn(async () => 0) },
  },
}));
vi.mock("../bridge/phone-room", () => ({ ensurePhoneRoom: vi.fn(async () => "room1") }));
vi.mock("../calls/service", () => ({
  acceptInboundCall: vi.fn(async () => ({})),
  countActiveCalls: vi.fn(async () => 0),
  statusForHangup: vi.fn(() => "completed"),
}));
vi.mock("./client", () => ({
  sendSms: vi.fn(async () => ({ data: { id: "m1" } })),
  rejectCall: vi.fn(async () => ({})),
}));

import * as client from "./client";
import { acceptInboundCall, countActiveCalls } from "../calls/service";
import { db } from "@/lib/db";
import { loadTelnyxConfig, TelnyxConfigError } from "./config";
import { parseTelnyxEvent, type TelnyxEvent } from "./events";
import { handleTelnyxEvent } from "./handler";
import { verifyTelnyxSignature } from "./signature";

const env = {
  TELNYX_API_KEY: "k", TELNYX_PUBLIC_KEY: "p", TELNYX_FROM_NUMBER: "+15550001111",
  TELNYX_OWNER_USER_ID: "u1", TELNYX_ALLOWED_NUMBERS: "+15552223333",
};
const config = loadTelnyxConfig(env as unknown as NodeJS.ProcessEnv);

describe("config", () => {
  it("fails when required variables are missing", () => {
    expect(() => loadTelnyxConfig({} as NodeJS.ProcessEnv)).toThrow(TelnyxConfigError);
  });
});

describe("signature", () => {
  const { publicKey, privateKey } = generateKeyPairSync("ed25519");
  const rawKey = publicKey.export({ format: "der", type: "spki" }).subarray(-32).toString("base64");
  const body = '{"data":{}}';
  const ts = "1700000000";
  const sig = sign(null, Buffer.from(`${ts}|${body}`), privateKey).toString("base64");
  const nowMs = 1_700_000_000_000;

  it("accepts a valid signature", () => {
    expect(verifyTelnyxSignature({ rawBody: body, signature: sig, timestamp: ts, publicKey: rawKey, nowMs }).ok).toBe(true);
  });
  it("rejects a tampered body, stale timestamp, and missing headers", () => {
    expect(verifyTelnyxSignature({ rawBody: body + " ", signature: sig, timestamp: ts, publicKey: rawKey, nowMs }).ok).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, signature: sig, timestamp: ts, publicKey: rawKey, nowMs: nowMs + 600_000 }).ok).toBe(false);
    expect(verifyTelnyxSignature({ rawBody: body, signature: null, timestamp: ts, publicKey: rawKey, nowMs }).ok).toBe(false);
  });
});

describe("events", () => {
  it("parses an inbound SMS and ignores unknown types", () => {
    const sms = parseTelnyxEvent({ data: { id: "e1", event_type: "message.received", payload: { from: { phone_number: "+1555" }, text: "hi" } } });
    expect(sms).toMatchObject({ kind: "sms", from: "+1555", text: "hi" });
    expect(parseTelnyxEvent({ data: { id: "e2", event_type: "message.sent", payload: {} } }).kind).toBe("ignored");
  });
  it("parses call.hangup and message.finalized", () => {
    expect(parseTelnyxEvent({ data: { id: "h", event_type: "call.hangup", payload: { call_control_id: "c", hangup_cause: "normal_clearing" } } }))
      .toMatchObject({ kind: "call.hangup", cause: "normal_clearing" });
    expect(parseTelnyxEvent({ data: { id: "f", event_type: "message.finalized", payload: { id: "m", to: [{ status: "delivered" }] } } }))
      .toMatchObject({ kind: "sms.status", status: "delivered" });
  });
  it("ignores outbound call legs", () => {
    const e = parseTelnyxEvent({ data: { id: "e3", event_type: "call.initiated", payload: { call_control_id: "c", direction: "outgoing" } } });
    expect(e.kind).toBe("ignored");
  });
});

describe("handler", () => {
  beforeEach(() => {
    redis.store.clear();
    vi.clearAllMocks();
  });

  it("replies to a trusted SMS in the Phone room, stores both sides, and deduplicates redelivery", async () => {
    const event: TelnyxEvent = { kind: "sms", id: "e1", messageId: "m-in", from: "+15552223333", to: "+15550001111", text: "hi", mediaUrls: [] };
    await handleTelnyxEvent(config, event);
    await handleTelnyxEvent(config, event);
    expect(client.sendSms).toHaveBeenCalledTimes(1);
    expect(client.sendSms).toHaveBeenCalledWith(config, "+15552223333", "hello back");
    expect(db.phoneMessage.create).toHaveBeenCalledTimes(2);
  });

  it("stores but never answers SMS from unknown numbers", async () => {
    await handleTelnyxEvent(config, { kind: "sms", id: "e2", messageId: "m2", from: "+19998887777", to: undefined, text: "hi", mediaUrls: [] });
    expect(client.sendSms).not.toHaveBeenCalled();
    expect(db.phoneMessage.create).toHaveBeenCalledWith(expect.objectContaining({ data: expect.objectContaining({ trust: "screened" }) }));
  });

  it("passes MMS attachment URLs to the agent as data", async () => {
    const { runVoiceReasoningTurn } = await import("@/lib/voice/reasoning-bridge");
    await handleTelnyxEvent(config, { kind: "sms", id: "e3", messageId: "m3", from: "+15552223333", to: undefined, text: "see photo", mediaUrls: ["https://x/y.jpg"] });
    expect(vi.mocked(runVoiceReasoningTurn).mock.calls[0][0].request).toContain("https://x/y.jpg");
  });

  it("accepts trusted and unknown inbound calls, flagging trust correctly", async () => {
    await handleTelnyxEvent(config, { kind: "call.initiated", id: "c1", callControlId: "cc1", sessionId: "s", from: "+15552223333", to: "+15550001111" });
    await handleTelnyxEvent(config, { kind: "call.initiated", id: "c2", callControlId: "cc2", sessionId: "s", from: "+19998887777", to: "+15550001111" });
    expect(vi.mocked(acceptInboundCall).mock.calls.map((c) => c[2])).toEqual([true, false]);
  });

  it("rejects unknown callers when configured to, and rejects when all lines are busy", async () => {
    const strict = loadTelnyxConfig({ ...env, TELNYX_UNKNOWN_CALLERS: "reject" } as unknown as NodeJS.ProcessEnv);
    await handleTelnyxEvent(strict, { kind: "call.initiated", id: "c3", callControlId: "cc3", sessionId: "s", from: "+19998887777", to: undefined });
    expect(client.rejectCall).toHaveBeenCalledWith(strict, "cc3");
    vi.mocked(countActiveCalls).mockResolvedValueOnce(99);
    await handleTelnyxEvent(config, { kind: "call.initiated", id: "c4", callControlId: "cc4", sessionId: "s", from: "+15552223333", to: undefined });
    expect(client.rejectCall).toHaveBeenCalledWith(config, "cc4");
    expect(acceptInboundCall).not.toHaveBeenCalled();
  });
});
