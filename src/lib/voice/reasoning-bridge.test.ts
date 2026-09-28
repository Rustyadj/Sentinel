// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ routeRuntimeChat: vi.fn(), cancel: vi.fn(), audit: vi.fn() }));
vi.mock("@/lib/agents/runtime/service", () => ({ getRuntimeAdapter: () => ({ cancel: mocks.cancel }) }));
vi.mock("@/lib/workspaces/audit", () => ({ writeAuditLog: mocks.audit }));
vi.mock("@/lib/agents/runtime/chat-routing", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/agents/runtime/chat-routing")>();
  return { ...actual, routeRuntimeChat: mocks.routeRuntimeChat };
});

import { isVoiceCapableRuntimeAgent, runVoiceReasoningTurn } from "./reasoning-bridge";

/** Builds the SSE stream the runtime returns for one turn. */
function runtimeStream(events: object[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      const encoder = new TextEncoder();
      for (const event of events) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(event)}\n\n`));
      }
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "text/event-stream" } });
}

describe("voice reasoning bridge", () => {
  beforeEach(() => vi.clearAllMocks());

  it("routes a spoken turn through the agent's own runtime, not a voice-specific one", async () => {
    mocks.routeRuntimeChat.mockResolvedValue(
      runtimeStream([
        { type: "text", text: "Three crews " },
        { type: "text", text: "are on site." },
      ]),
    );

    const result = await runVoiceReasoningTurn({
      agentId: "hermes-lisa",
      userId: "user-1",
      roomId: "room-1",
      request: "How many crews are on site?",
    });

    expect(result.answer).toBe("Three crews are on site.");
    // The same entry point a typed message uses — same memory, tools, audit.
    expect(mocks.routeRuntimeChat).toHaveBeenCalledWith({
      agentId: "hermes-lisa",
      userId: "user-1",
      roomId: "room-1",
      userContent: "How many crews are on site?",
      mode: "persistent_agent_runtime",
    });
  });

  it("never lets the caller choose which model thinks", async () => {
    mocks.routeRuntimeChat.mockResolvedValue(runtimeStream([{ type: "text", text: "ok" }]));
    await runVoiceReasoningTurn({ agentId: "hermes-nathan2", userId: "user-1", request: "hi" });

    // No model/provider is passed in: the agent's configuration decides,
    // which is what stops a voice session swapping one agent's brain for
    // another's.
    const call = mocks.routeRuntimeChat.mock.calls[0][0];
    expect(call).not.toHaveProperty("model");
    expect(call).not.toHaveProperty("reasoningModel");
    expect(call.agentId).toBe("hermes-nathan2");
  });

  it("counts tool executions and reports the model that actually ran", async () => {
    mocks.routeRuntimeChat.mockResolvedValue(
      runtimeStream([
        { event: { type: "tool_call", data: { name: "sentinel_list_tasks" } } },
        { event: { type: "tool_result", data: {} } },
        { event: { type: "tool_call", data: { name: "search" } } },
        { type: "text", text: "Done." },
        { event: { type: "status", data: { actualModel: "deepseek/deepseek-v4.1-flash", usage: { inputTokens: 120, outputTokens: 34 } } } },
      ]),
    );

    const result = await runVoiceReasoningTurn({
      agentId: "hermes-lisa",
      userId: "user-1",
      request: "What's outstanding?",
    });

    expect(result.toolCalls).toBe(2);
    expect(result.executedModel).toBe("deepseek/deepseek-v4.1-flash");
    expect(result.inputTokens).toBe(120);
    expect(result.outputTokens).toBe(34);
    expect(result.latencyMs).toBeGreaterThanOrEqual(0);
  });

  it("counts Hermes tool starts (tool_started), once per tool, and names them", async () => {
    mocks.routeRuntimeChat.mockResolvedValue(
      runtimeStream([
        { type: "runtime_event", event: { type: "tool_started", data: { phase: "tool.start", name: "get_active_rentals" } } },
        { type: "runtime_event", event: { type: "tool_started", data: { phase: "tool.generating", name: "get_active_rentals" } } },
        { type: "runtime_event", event: { type: "tool_completed", data: { name: "get_active_rentals" } } },
        { type: "text", text: "Two." },
      ]),
    );
    const result = await runVoiceReasoningTurn({ agentId: "hermes-nathan2", userId: "user-1", request: "rentals?" });
    expect(result.toolCalls).toBe(1);
    expect(result.toolNames).toEqual(["get_active_rentals"]);
  });

  it("cancels the runtime session when the caller aborts (user interrupted)", async () => {
    const controller = new AbortController();
    const encoder = new TextEncoder();
    mocks.cancel.mockResolvedValue({ success: true });
    mocks.audit.mockResolvedValue(undefined);
    // A turn that streams its session frame and then stalls, like a slow runtime.
    mocks.routeRuntimeChat.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(c) {
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "source", sessionId: "sess-9", runtime: "hermes" })}\n\n`));
        c.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: "Partial" })}\n\n`));
        setTimeout(() => controller.abort(), 10);
      },
    })));
    const onFirstText = vi.fn();
    const result = await runVoiceReasoningTurn({ agentId: "hermes-lisa", userId: "user-1", request: "long one", signal: controller.signal, onFirstText });
    expect(result.cancelled).toBe(true);
    expect(onFirstText).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(mocks.cancel).toHaveBeenCalledWith("sess-9"));
  });

  it("survives a malformed frame rather than dropping the turn", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        controller.enqueue(encoder.encode("data: {not json}\n\n"));
        controller.enqueue(encoder.encode(`data: ${JSON.stringify({ type: "text", text: "still here" })}\n\n`));
        controller.close();
      },
    });
    mocks.routeRuntimeChat.mockResolvedValue(new Response(body));

    const result = await runVoiceReasoningTurn({ agentId: "hermes-lisa", userId: "user-1", request: "hi" });
    expect(result.answer).toBe("still here");
  });

  it("refuses an agent with no runtime instead of inventing one", async () => {
    await expect(
      runVoiceReasoningTurn({ agentId: "hermes-clint", userId: "user-1", request: "hi" }),
    ).rejects.toThrow(/no runtime/i);
    expect(mocks.routeRuntimeChat).not.toHaveBeenCalled();
  });

  it("knows which agents have a runtime behind them", () => {
    expect(isVoiceCapableRuntimeAgent("hermes-lisa")).toBe(true);
    expect(isVoiceCapableRuntimeAgent("hermes-nathan2")).toBe(true);
    expect(isVoiceCapableRuntimeAgent("hermes-clint")).toBe(false);
  });
});
