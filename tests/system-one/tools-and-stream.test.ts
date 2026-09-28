// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { observeRuntimeStream } from "@/lib/system-one/stream-observer";
import { resolveAgentConnector, toReadOnlyDescriptors, type ListedTool } from "@/lib/system-one/read-only-tools";

const READ_ONLY = { readOnlyHint: true, destructiveHint: false };
const MUTATING = { readOnlyHint: false, destructiveHint: true };

describe("read-only tool eligibility", () => {
  const listed: ListedTool[] = [
    { name: "operational_status", description: "status", annotations: READ_ONLY, inputSchema: { properties: {} } },
    { name: "inventory_search", annotations: READ_ONLY, inputSchema: { properties: { query: { type: "string" } }, required: ["query"] } },
    { name: "get_inventory_conflicts", annotations: READ_ONLY, inputSchema: { properties: { days: { type: "integer" } } } },
    { name: "rental_list_by_state", annotations: READ_ONLY, inputSchema: { properties: { state: { enum: ["active", "returned"] } }, required: ["state"] } },
    { name: "equipment_checkout", annotations: MUTATING, inputSchema: { properties: {} } },
    { name: "unannotated_tool", inputSchema: { properties: {} } },
    { name: "contradictory", annotations: { readOnlyHint: true, destructiveHint: true } },
  ];
  const tools = toReadOnlyDescriptors("mobileops", listed);

  it("admits only tools the server annotates read-only and non-destructive", () => {
    expect(tools.map((t) => t.name)).toEqual(["operational_status", "inventory_search", "get_inventory_conflicts", "rental_list_by_state"]);
  });

  it("marks a tool fast-path eligible only when every required argument is enumerable", () => {
    const byName = Object.fromEntries(tools.map((t) => [t.name, t]));
    expect(byName.operational_status.fastPathEligible).toBe(true);
    expect(byName.get_inventory_conflicts.fastPathEligible).toBe(true); // optional arg only
    expect(byName.rental_list_by_state.fastPathEligible).toBe(true);
    expect(byName.rental_list_by_state.enumArguments.state).toEqual(["active", "returned"]);
    expect(byName.inventory_search.fastPathEligible).toBe(false); // free-text query
  });
});

describe("per-agent connector isolation", () => {
  const env = {
    SENTINEL_AGENT_MCP_HERMES_NATHAN2_URL: "https://icfops.example/api/mcp/",
    SENTINEL_AGENT_MCP_HERMES_NATHAN2_TOKEN: "nathan2-token",
    SENTINEL_AGENT_MCP_HERMES_NATHAN2_NAME: "mobileops",
  };

  it("resolves a connector only for the agent it is configured under", () => {
    expect(resolveAgentConnector("hermes-nathan2", env)?.token).toBe("nathan2-token");
    expect(resolveAgentConnector("hermes-lisa", env)).toBeNull();
  });

  it("refuses plaintext http to a non-local host", () => {
    expect(resolveAgentConnector("hermes-nathan2", { ...env, SENTINEL_AGENT_MCP_HERMES_NATHAN2_URL: "http://icfops.example/api/mcp/" })).toBeNull();
    expect(resolveAgentConnector("hermes-nathan2", { ...env, SENTINEL_AGENT_MCP_HERMES_NATHAN2_URL: "http://127.0.0.1:8001/api/mcp/" })).not.toBeNull();
  });

  it("requires both URL and token", () => {
    expect(resolveAgentConnector("hermes-nathan2", { SENTINEL_AGENT_MCP_HERMES_NATHAN2_URL: env.SENTINEL_AGENT_MCP_HERMES_NATHAN2_URL })).toBeNull();
  });
});

function sse(events: unknown[]): Response {
  const encoder = new TextEncoder();
  return new Response(new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`));
      controller.enqueue(encoder.encode("data: [DONE]\n\n"));
      controller.close();
    },
  }), { headers: { "Content-Type": "text/event-stream" } });
}

describe("runtime stream observer", () => {
  const events = [
    { type: "source", sessionId: "s1", runtime: "hermes" },
    { type: "runtime_event", event: { type: "tool_started", data: { phase: "tool.start", name: "get_active_rentals" } } },
    { type: "runtime_event", event: { type: "tool_started", data: { phase: "tool.generating", name: "get_active_rentals" } } },
    { type: "text", text: "Two rentals are active." },
    { type: "runtime_event", event: { type: "status", data: { actualModel: "gpt-5.6-luna", usage: { input_tokens: 900, output_tokens: 40 } } } },
  ];

  it("passes the stream through byte-for-byte and reports what System 2 did", async () => {
    const original = await sse(events).text();
    const onComplete = vi.fn();
    const onFirstText = vi.fn();
    const observed = observeRuntimeStream(sse(events), { onComplete, onFirstText });
    expect(await observed.text()).toBe(original);
    expect(onFirstText).toHaveBeenCalledTimes(1);
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledTimes(1));
    expect(onComplete.mock.calls[0][0]).toEqual({ toolNames: ["get_active_rentals"], model: "gpt-5.6-luna", inputTokens: 900, outputTokens: 40, aborted: false });
  });

  it("reports an aborted turn when the client cancels", async () => {
    const onComplete = vi.fn();
    const observed = observeRuntimeStream(sse(events), { onComplete });
    await observed.body!.cancel();
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalled());
    expect(onComplete.mock.calls[0][0].aborted).toBe(true);
  });
});
