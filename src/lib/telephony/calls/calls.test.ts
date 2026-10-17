import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ leases: new Set<string>(), counter: 0, rows: new Map<string, Record<string, unknown>>() }));

vi.mock("@/lib/redis", () => ({
  redisAcquireLease: async (k: string) => (state.leases.has(k) ? false : (state.leases.add(k), true)),
  redisIncrementWithExpiry: async () => ++state.counter,
}));
vi.mock("@/lib/db", () => ({
  db: {
    phoneContact: { findUnique: vi.fn(async () => null), findMany: vi.fn(async () => []) },
    phoneCall: {
      count: vi.fn(async () => 0),
      findUnique: vi.fn(async ({ where }: { where: { userId_idempotencyKey?: { idempotencyKey: string } } }) =>
        where.userId_idempotencyKey
          ? [...state.rows.values()].find((r) => r.idempotencyKey === where.userId_idempotencyKey!.idempotencyKey) ?? null
          : null),
      create: vi.fn(async ({ data }: { data: Record<string, unknown> }) => {
        const row = { id: `c${state.rows.size + 1}`, ...data };
        state.rows.set(row.id, row);
        return row;
      }),
      update: vi.fn(async ({ where, data }: { where: { id: string }; data: Record<string, unknown> }) =>
        Object.assign(state.rows.get(where.id)!, data)),
    },
  },
}));
vi.mock("@/lib/workspaces/audit", () => ({ writeAuditLog: vi.fn(async () => ({})) }));
vi.mock("../telnyx/client", () => ({
  dial: vi.fn(async () => ({ data: { call_control_id: "v2:abc", call_session_id: "s1" } })),
  answerCallWithStream: vi.fn(async () => ({})),
}));

import * as client from "../telnyx/client";
import { loadTelnyxConfig } from "../telnyx/config";
import { issueMediaToken, verifyMediaToken } from "./media-token";
import { assertDialable, CallPolicyError } from "./policy";
import { acceptInboundCall, placeOutboundCall, statusForHangup } from "./service";

const config = loadTelnyxConfig({
  TELNYX_API_KEY: "k", TELNYX_PUBLIC_KEY: "p", TELNYX_FROM_NUMBER: "+15550001111", TELNYX_OWNER_USER_ID: "owner",
  TELNYX_CONNECTION_ID: "conn1", TELNYX_MEDIA_WS_URL: "wss://sentinel.example/telephony/media",
  TELNYX_MEDIA_TOKEN_SECRET: "x".repeat(40), TELNYX_ALLOWED_NUMBERS: "+15552223333",
  TELNYX_NUMBER_ROUTES: JSON.stringify({ "+15550009999": "hermes-nathan2" }),
} as unknown as NodeJS.ProcessEnv);

beforeEach(() => { state.leases.clear(); state.rows.clear(); state.counter = 0; vi.clearAllMocks(); });

describe("media token", () => {
  const secret = "s".repeat(40);
  it("accepts a fresh token and returns the call id", () => {
    expect(verifyMediaToken(secret, issueMediaToken(secret, "call1"))).toBe("call1");
  });
  it("rejects tampering, wrong secret, expiry and garbage", () => {
    const token = issueMediaToken(secret, "call1", 1_000_000);
    expect(verifyMediaToken(secret, token.replace("call1", "call2"), 1_000_000)).toBeNull();
    expect(verifyMediaToken("o".repeat(40), token, 1_000_000)).toBeNull();
    expect(verifyMediaToken(secret, token, 1_000_000 + 121_000)).toBeNull();
    expect(verifyMediaToken(secret, "nope")).toBeNull();
    expect(verifyMediaToken(secret, null)).toBeNull();
  });
});

describe("destination policy", () => {
  it("blocks premium, emergency, foreign-by-default and malformed numbers", () => {
    for (const n of ["+19005551234", "+911", "+442079460000", "5551234", "+15550001111"]) {
      expect(() => assertDialable(config, n), n).toThrow(CallPolicyError);
    }
    expect(() => assertDialable(config, "+14155550123")).not.toThrow();
  });
});

describe("placeOutboundCall", () => {
  const base = { userId: "u1", agent: "lisa", target: "+14155550123", purpose: "ask about membrane" };

  it("dials with bidirectional μ-law streaming and a signed stream URL, as the named agent", async () => {
    const { call, replayed } = await placeOutboundCall(base, config);
    expect(replayed).toBe(false);
    expect(call).toMatchObject({ agentId: "hermes-lisa", status: "ringing", telnyxCallControlId: "v2:abc" });
    const args = vi.mocked(client.dial).mock.calls[0][1];
    expect(args.to).toBe("+14155550123");
    expect(new URL(args.streamUrl).searchParams.get("t")).toMatch(/^c1\./);
  });

  it("is replay-safe on the idempotency key", async () => {
    await placeOutboundCall({ ...base, idempotencyKey: "key-12345678" }, config);
    state.leases.clear();
    const again = await placeOutboundCall({ ...base, idempotencyKey: "key-12345678" }, config);
    expect(again.replayed).toBe(true);
    expect(client.dial).toHaveBeenCalledTimes(1);
  });

  it("suppresses a second call to the same number even with a fresh key", async () => {
    await placeOutboundCall({ ...base, idempotencyKey: "key-aaaaaaaa" }, config);
    await expect(placeOutboundCall({ ...base, idempotencyKey: "key-bbbbbbbb" }, config)).rejects.toMatchObject({ code: "duplicate" });
    expect(client.dial).toHaveBeenCalledTimes(1);
  });

  it("refuses unknown agents, blocked destinations and a missing purpose before contacting Telnyx", async () => {
    await expect(placeOutboundCall({ ...base, agent: "claude-code" }, config)).rejects.toBeInstanceOf(CallPolicyError);
    await expect(placeOutboundCall({ ...base, target: "+19005551234" }, config)).rejects.toMatchObject({ code: "destination_blocked" });
    await expect(placeOutboundCall({ ...base, purpose: "  " }, config)).rejects.toBeInstanceOf(CallPolicyError);
    expect(client.dial).not.toHaveBeenCalled();
  });

  it("enforces the hourly rate limit", async () => {
    state.counter = config.outboundCallsPerHour;
    await expect(placeOutboundCall(base, config)).rejects.toMatchObject({ code: "rate_limited" });
  });

  it("marks the call failed when the carrier rejects the dial", async () => {
    vi.mocked(client.dial).mockRejectedValueOnce(new Error("boom"));
    await expect(placeOutboundCall(base, config)).rejects.toThrow("boom");
    expect([...state.rows.values()][0].status).toBe("failed");
  });
});

describe("acceptInboundCall", () => {
  it("routes by dialed number and marks unknown callers screened", async () => {
    const call = await acceptInboundCall(config, { callControlId: "cc1", from: "+19998887777", to: "+15550009999" }, false);
    expect(call).toMatchObject({ agentId: "hermes-nathan2", trust: "screened", direction: "inbound", userId: "owner" });
    expect(client.answerCallWithStream).toHaveBeenCalledOnce();
  });
  it("defaults to the configured inbound agent for trusted callers", async () => {
    const call = await acceptInboundCall(config, { callControlId: "cc2", from: "+15552223333", to: "+15550001111" }, true);
    expect(call).toMatchObject({ agentId: "hermes-lisa", trust: "trusted" });
  });
});

describe("statusForHangup", () => {
  it("maps causes", () => {
    expect(statusForHangup("normal_clearing", true)).toBe("completed");
    expect(statusForHangup("user_busy", false)).toBe("busy");
    expect(statusForHangup("timeout", false)).toBe("no_answer");
    expect(statusForHangup("call_rejected", false)).toBe("rejected");
    expect(statusForHangup(undefined, false)).toBe("failed");
  });
});
