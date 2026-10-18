// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { classifyDispatch, observeDispatch, withClassifiedTurn } from "@/lib/system-one/dispatch";
import { resetSystemOneForTests, SystemOneDecisionService } from "@/lib/system-one/service";
import { resolveSystemOneConfig } from "@/lib/system-one/config";
import type { RuntimeEvent } from "@/lib/agents/runtime/types";
import type { SystemOneProvider } from "@/lib/system-one/types";

afterEach(() => { resetSystemOneForTests(); vi.unstubAllEnvs(); });
function configure(fail = false) {
  vi.stubEnv("SYSTEM_ONE_MODE", "active");
  const config = resolveSystemOneConfig({ SYSTEM_ONE_API_KEY: "test-only" });
  const evaluate = vi.fn<SystemOneProvider["evaluate"]>(async request => {
    if (fail) throw new Error("unavailable");
    return { model: "jev-1.13.0", inputTokens: 120, costUsd: null,
      answers: Object.fromEntries(Object.entries(request.questions).map(([id, q]) => [id, q.type === "choice"
        ? { type: "choice", choice: id === "intent" ? "coding" : id === "route" ? "agent_runtime" : id === "requested_agent" ? "codex" : "workspace", confidence: .99, probabilities: {} }
        : q.type === "noul" ? { type: "noul", noul: id === "needs_system2" || id === "needs_memory" ? 1 : 0 }
        : { type: "score", score: q.criteria.length - 1, confidence: 1, probabilities: {}, levels: q.criteria.length }])) };
  });
  resetSystemOneForTests({ service: new SystemOneDecisionService({ name: "jev", evaluate }, config), config });
  return evaluate;
}
describe("governed dispatch routing", () => {
  it.each(["hermes-lisa", "hermes-nathan2", "claude-code", "codex"])("classifies %s without changing the assigned identity/model", async agentId => {
    const evaluate = configure();
    const routing = await classifyDispatch({ agentId, userId: "jev-dispatch-test", request: "Implement this change", configuredModel: "explicit-reasoner", surface: agentId.startsWith("hermes") ? "telegram" : "orchestration" });
    expect(evaluate).toHaveBeenCalledOnce();
    const state = evaluate.mock.calls[0][0].state;
    expect(state.execution_constraints).toMatchObject({ agent: agentId, model: "explicit-reasoner" });
    expect(state).not.toHaveProperty("memories");
    expect(state.available_tools).toEqual([]);
    expect(routing.skipMemory).toBe(false);
    const sequence: string[] = [];
    async function* execute() { sequence.push("executed"); yield { type: "completed", sessionId: "test", sequence: 1, timestamp: new Date().toISOString(), data: { model: "explicit-reasoner", usage: { input_tokens: 42, output_tokens: 7 } } } as RuntimeEvent; }
    for await (const event of observeDispatch(routing, execute())) expect(event.type).toBe("completed");
    expect(sequence).toEqual(["executed"]);
    const row = await db.systemOneDecision.findUniqueOrThrow({ where: { id: routing.recordId! } });
    expect(row.decision).toMatchObject({ requestedAgent: "codex" });
    expect(row).toMatchObject({ agentId, system2Invoked: true, system2Model: "explicit-reasoner", system2InputTokens: 42 });
  });
  it("provider failure retains full governed System-2 routing and memory", async () => {
    configure(true);
    const routing = await classifyDispatch({ agentId: "codex", userId: "jev-dispatch-test", request: "Continue", surface: "runtime_api", memoryRetrievalSkippable: true });
    expect(routing.skipMemory).toBe(false);
    expect(await db.systemOneDecision.findUnique({ where: { id: routing.recordId! } })).toMatchObject({ outcome: "error", executedPath: "system2", system2Invoked: false });
  });
});


describe("existing voice classification", () => {
  it("reuses the server-owned turn only for the same user, agent and request", async () => {
    const evaluate = configure();
    const identity = { agentId: "hermes-lisa", userId: "jev-dispatch-test", request: "hello" };
    await withClassifiedTurn(identity, async () => {
      expect((await classifyDispatch({ ...identity, surface: "runtime_chat" })).recordId).toBeNull();
      await classifyDispatch({ ...identity, agentId: "hermes-nathan2", surface: "runtime_chat" });
    });
    expect(evaluate).toHaveBeenCalledOnce();
    await classifyDispatch({ ...identity, surface: "runtime_chat" });
    expect(evaluate).toHaveBeenCalledTimes(2);
  });
});
