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
vi.mock("./client", () => ({
  sendSms: vi.fn(async () => ({})),
  answerCall: vi.fn(async () => ({})),
  hangupCall: vi.fn(async () => ({})),
  speak: vi.fn(async () => ({})),
  startTranscription: vi.fn(async () => ({})),
}));

import * as client from "./client";
import { loadTelnyxConfig, TelnyxConfigError } from "./config";
import { parseTelnyxEvent } from "./events";
import { handleTelnyxEvent } from "./handler";
import { verifyTelnyxSignature } from "./signature";

const env: NodeJS.ProcessEnv = {
  TELNYX_API_KEY: "k", TELNYX_PUBLIC_KEY: "p", TELNYX_FROM_NUMBER: "+15550001111",
  TELNYX_OWNER_USER_ID: "u1", TELNYX_ALLOWED_NUMBERS: "+15552223333",
};
const config = loadTelnyxConfig(env);

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
    expect(parseTelnyxEvent({ data: { id: "e2", event_type: "message.finalized", payload: {} } }).kind).toBe("ignored");
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

  it("replies to an allowed SMS and deduplicates redelivery", async () => {
    const event = { kind: "sms", id: "e1", from: "+15552223333", text: "hi" } as const;
    await handleTelnyxEvent(config, event);
    await handleTelnyxEvent(config, event);
    expect(client.sendSms).toHaveBeenCalledTimes(1);
    expect(client.sendSms).toHaveBeenCalledWith(config, "+15552223333", "hello back");
  });

  it("drops SMS from numbers not on the allowlist", async () => {
    await handleTelnyxEvent(config, { kind: "sms", id: "e2", from: "+19998887777", text: "hi" });
    expect(client.sendSms).not.toHaveBeenCalled();
  });

  it("hangs up on unknown callers and answers allowed ones", async () => {
    await handleTelnyxEvent(config, { kind: "call.initiated", id: "c1", callControlId: "cc1", from: "+19998887777" });
    expect(client.hangupCall).toHaveBeenCalledWith(config, "cc1");
    await handleTelnyxEvent(config, { kind: "call.initiated", id: "c2", callControlId: "cc2", from: "+15552223333" });
    expect(client.answerCall).toHaveBeenCalledWith(config, "cc2");
  });

  it("ignores transcription for calls that were never screened in", async () => {
    await handleTelnyxEvent(config, { kind: "call.transcription", id: "t1", callControlId: "ghost", from: undefined, transcript: "hi", isFinal: true });
    expect(client.speak).not.toHaveBeenCalled();
  });

  it("speaks the agent answer for a screened call", async () => {
    await handleTelnyxEvent(config, { kind: "call.initiated", id: "c3", callControlId: "cc3", from: "+15552223333" });
    await handleTelnyxEvent(config, { kind: "call.transcription", id: "t2", callControlId: "cc3", from: undefined, transcript: "status?", isFinal: true });
    expect(client.speak).toHaveBeenCalledWith(config, "cc3", "hello back");
  });
});
