// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { confidentToolDecision, statusTool, testConfig } from "./fixtures";

const mocks = vi.hoisted(() => ({
  requireUser: vi.fn(),
  findRoom: vi.fn(),
  createDecision: vi.fn(),
  runTurn: vi.fn(),
  recordTurn: vi.fn(),
  callTool: vi.fn(),
  peekTools: vi.fn(),
  decide: vi.fn(),
}));
vi.mock("@/lib/current-user", () => ({ requireUser: mocks.requireUser }));
vi.mock("@/lib/db", () => ({
  db: {
    chatRoom: { findFirst: mocks.findRoom },
    systemOneDecision: { create: mocks.createDecision, findMany: vi.fn(async () => []) },
  },
}));
vi.mock("@/lib/voice/reasoning-bridge", () => ({ runVoiceReasoningTurn: mocks.runTurn }));
vi.mock("@/lib/voice/telemetry", () => ({ recordReasoningTurn: mocks.recordTurn }));
vi.mock("@/lib/system-one/read-only-tools", () => ({
  callReadOnlyTool: mocks.callTool,
  peekReadOnlyTools: mocks.peekTools,
  listReadOnlyTools: vi.fn(async () => []),
}));

import { POST } from "@/app/api/voice/reasoning/route";
import { resetSystemOneForTests, SystemOneDecisionService } from "@/lib/system-one/service";

function request(body: unknown) {
  return new Request("http://localhost/api/voice/reasoning", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  }) as unknown as Parameters<typeof POST>[0];
}

function useDecision(outcome: "ok" | "timeout", decision = confidentToolDecision()) {
  const service = { decide: mocks.decide, breakerState: () => "closed", providerName: "fake" } as unknown as SystemOneDecisionService;
  mocks.decide.mockResolvedValue({
    outcome, decision: outcome === "ok" ? decision : null, provider: "fake", providerModel: "jev-1.13", latencyMs: 90, inputTokens: 500, costUsd: 0.00002,
  });
  resetSystemOneForTests({ service, config: testConfig() });
}

const system2Answer = {
  answer: "Everything is running.", latencyMs: 2400, toolCalls: 1, inputTokens: 3000, outputTokens: 60,
  executedModel: "gpt-5.6-luna", toolNames: ["operational_status"], cancelled: false,
};

describe("voice reasoning with System 1", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    mocks.findRoom.mockResolvedValue({ id: "room-1", agentIds: ["hermes-nathan2"] });
    mocks.createDecision.mockResolvedValue({ id: "d1" });
    mocks.runTurn.mockResolvedValue(system2Answer);
    mocks.recordTurn.mockResolvedValue(undefined);
    mocks.peekTools.mockReturnValue([statusTool]);
  });
  afterEach(() => {
    vi.unstubAllEnvs();
    resetSystemOneForTests(null);
  });

  it("active: answers a confident read-only lookup from the tool, never invoking System 2", async () => {
    vi.stubEnv("SYSTEM_ONE_MODE", "active");
    useDecision("ok");
    mocks.callTool.mockResolvedValue({ ok: true, data: { crewsOnSite: 3 }, latencyMs: 180 });

    const response = await POST(request({ agentId: "hermes-nathan2", roomId: "room-1", request: "What's our operational status?" }));
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.fastPath).toBe(true);
    expect(payload.structured.data).toContain("crewsOnSite");
    expect(mocks.runTurn).not.toHaveBeenCalled();
    expect(mocks.callTool).toHaveBeenCalledWith(expect.objectContaining({ agentId: "hermes-nathan2", toolId: statusTool.id }));
    await vi.waitFor(() => expect(mocks.createDecision).toHaveBeenCalled());
    const row = mocks.createDecision.mock.calls[0][0].data;
    expect(row).toMatchObject({ executedPath: "fast_path_tool", system2Invoked: false, system2Avoided: true, mode: "active" });
  });

  it("active: a failed tool call falls back to System 2 instead of failing the turn", async () => {
    vi.stubEnv("SYSTEM_ONE_MODE", "active");
    useDecision("ok");
    mocks.callTool.mockResolvedValue({ ok: false, data: null, latencyMs: 40, error: "connector unavailable" });

    const payload = await (await POST(request({ agentId: "hermes-nathan2", roomId: "room-1", request: "status?" }))).json();

    expect(payload.answer).toBe(system2Answer.answer);
    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocks.createDecision).toHaveBeenCalled());
    expect(mocks.createDecision.mock.calls[0][0].data.executedPath).toBe("fast_path_failed");
  });

  it("active: a System 1 timeout takes today's path", async () => {
    vi.stubEnv("SYSTEM_ONE_MODE", "active");
    useDecision("timeout");
    const payload = await (await POST(request({ agentId: "hermes-nathan2", roomId: "room-1", request: "status?" }))).json();
    expect(payload.answer).toBe(system2Answer.answer);
    expect(mocks.callTool).not.toHaveBeenCalled();
  });

  it("active: a confident write request still goes to the agent's runtime", async () => {
    vi.stubEnv("SYSTEM_ONE_MODE", "active");
    useDecision("ok", confidentToolDecision({ intent: "write_action", readOnly: 0.02 }));
    await POST(request({ agentId: "hermes-nathan2", roomId: "room-1", request: "Check out two pumps to the Miller job" }));
    expect(mocks.callTool).not.toHaveBeenCalled();
    expect(mocks.runTurn).toHaveBeenCalledTimes(1);
  });

  it("shadow: always runs System 2, and records what System 1 would have done", async () => {
    vi.stubEnv("SYSTEM_ONE_MODE", "shadow");
    useDecision("ok");

    const payload = await (await POST(request({ agentId: "hermes-nathan2", roomId: "room-1", request: "status?" }))).json();

    expect(payload.answer).toBe(system2Answer.answer);
    expect(mocks.callTool).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.createDecision).toHaveBeenCalled());
    const row = mocks.createDecision.mock.calls[0][0].data;
    expect(row).toMatchObject({ mode: "shadow", plannedAction: "fast_path_tool", executedPath: "system2", system2Invoked: true, system2Tools: ["operational_status"] });
  });

  it("off: never calls System 1, but records the baseline", async () => {
    vi.stubEnv("SYSTEM_ONE_MODE", "off");
    useDecision("ok");
    await POST(request({ agentId: "hermes-nathan2", roomId: "room-1", request: "status?" }));
    expect(mocks.decide).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.createDecision).toHaveBeenCalled());
    expect(mocks.createDecision.mock.calls[0][0].data).toMatchObject({ mode: "off", outcome: "disabled", executedPath: "system2" });
  });

  it("reports an interrupted turn as cancelled rather than speaking a stale answer", async () => {
    vi.stubEnv("SYSTEM_ONE_MODE", "off");
    mocks.runTurn.mockResolvedValue({ ...system2Answer, cancelled: true });
    const response = await POST(request({ agentId: "hermes-nathan2", roomId: "room-1", request: "status?" }));
    expect(response.status).toBe(499);
  });
});

describe("voice interruption before System 2 starts", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    resetSystemOneForTests(null);
  });

  it("never starts a runtime turn for a request the user already abandoned", async () => {
    vi.clearAllMocks();
    vi.stubEnv("SYSTEM_ONE_MODE", "active");
    mocks.requireUser.mockResolvedValue({ id: "user-1" });
    mocks.findRoom.mockResolvedValue({ id: "room-1", agentIds: ["hermes-nathan2"] });
    mocks.createDecision.mockResolvedValue({ id: "d1" });
    mocks.peekTools.mockReturnValue([statusTool]);
    const controller = new AbortController();
    const service = { decide: mocks.decide, breakerState: () => "closed", providerName: "fake" } as unknown as SystemOneDecisionService;
    mocks.decide.mockImplementation(async () => {
      controller.abort(); // the user spoke again while System 1 was deciding
      return { outcome: "aborted", decision: null, provider: "fake", providerModel: null, latencyMs: 30, inputTokens: 0, costUsd: null };
    });
    resetSystemOneForTests({ service, config: testConfig() });

    const req = new Request("http://localhost/api/voice/reasoning", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId: "hermes-nathan2", roomId: "room-1", request: "status?" }), signal: controller.signal,
    }) as unknown as Parameters<typeof POST>[0];
    const response = await POST(req);

    expect(response.status).toBe(499);
    expect(mocks.runTurn).not.toHaveBeenCalled();
    await vi.waitFor(() => expect(mocks.createDecision).toHaveBeenCalled());
    expect(mocks.createDecision.mock.calls[0][0].data).toMatchObject({ interrupted: true, system2Invoked: false });
  });
});
