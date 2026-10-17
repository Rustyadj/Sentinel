import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  findUnique: vi.fn(),
  runTurn: vi.fn(async () => ({ answer: "ok", toolCalls: 2, cancelled: false })),
  summarize: vi.fn(async () => "summary"),
}));
vi.mock("@/lib/db", () => ({ db: { phoneCall: { findUnique: mocks.findUnique } } }));
vi.mock("@/lib/voice/reasoning-bridge", () => ({ runVoiceReasoningTurn: mocks.runTurn }));
vi.mock("@/lib/telephony/calls/summary", () => ({ summarizeCall: mocks.summarize }));

import { POST } from "./route";

const SECRET = "b".repeat(40);
const active = { id: "c1", agentId: "hermes-nathan2", userId: "owner", roomId: "room1", trust: "trusted", status: "active" };
const call = (payload: unknown, token: string | null = SECRET) =>
  new NextRequest("https://app/api/telephony/turn", {
    method: "POST", body: JSON.stringify(payload), headers: token ? { authorization: `Bearer ${token}` } : {},
  });

describe("POST /api/telephony/turn", () => {
  beforeEach(() => {
    vi.stubEnv("TELNYX_BRIDGE_SECRET", SECRET);
    mocks.findUnique.mockReset().mockResolvedValue(active);
    mocks.runTurn.mockClear();
  });

  it("fails closed without a matching secret, including when none is configured", async () => {
    expect((await POST(call({ mode: "turn", callId: "c1", request: "hi" }, null))).status).toBe(401);
    expect((await POST(call({ mode: "turn", callId: "c1", request: "hi" }, "wrong".repeat(10)))).status).toBe(401);
    vi.stubEnv("TELNYX_BRIDGE_SECRET", "");
    expect((await POST(call({ mode: "turn", callId: "c1", request: "hi" }, ""))).status).toBe(401);
  });

  it("runs the turn as the call's own agent, user and room -- identity comes from the row, not the request", async () => {
    const res = await POST(call({ mode: "turn", callId: "c1", request: "do you have stock?", agentId: "hermes-lisa", userId: "attacker" }));
    expect(res.status).toBe(200);
    expect(mocks.runTurn).toHaveBeenCalledWith(expect.objectContaining({ agentId: "hermes-nathan2", userId: "owner", roomId: "room1" }));
    expect(await res.json()).toEqual({ answer: "ok", toolCalls: 2 });
  });

  it("refuses screened calls and calls that are not active", async () => {
    mocks.findUnique.mockResolvedValueOnce({ ...active, trust: "screened" });
    expect((await POST(call({ mode: "turn", callId: "c1", request: "hi" }))).status).toBe(403);
    mocks.findUnique.mockResolvedValueOnce({ ...active, status: "completed" });
    expect((await POST(call({ mode: "turn", callId: "c1", request: "hi" }))).status).toBe(409);
    expect(mocks.runTurn).not.toHaveBeenCalled();
  });

  it("summarizes from stored turns only", async () => {
    const res = await POST(call({ mode: "summary", callId: "c1", transcript: "injected" }));
    expect(await res.json()).toEqual({ summary: "summary" });
    expect(mocks.summarize).toHaveBeenCalledWith("c1");
  });
});
