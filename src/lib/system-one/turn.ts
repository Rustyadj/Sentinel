/**
 * Per-turn System 1 helpers shared by every surface (typed chat, runtime chat,
 * voice). Call sites stay small: begin → (await or not, by mode) → plan →
 * maybe fast-path → record.
 */
import { resolveAgentMode, surfaceTimeoutMs } from "./config";
import { planRoute } from "./policy";
import type { DecisionInput } from "./questions";
import { callReadOnlyTool, listReadOnlyTools, peekReadOnlyTools, type ToolCallResult } from "./read-only-tools";
import { getSystemOne } from "./service";
import type { RequestTrace } from "./telemetry";
import type { ReadOnlyToolDescriptor, RoutingPlan, SystemOneMode, SystemOneResult, SystemOneSurface } from "./types";

export interface SystemOneTurn {
  mode: SystemOneMode;
  tools: ReadOnlyToolDescriptor[];
  /** Always settles; never rejects. */
  result: Promise<SystemOneResult>;
}

const disabled = (latencyMs = 0): SystemOneResult => ({
  outcome: "disabled", decision: null, provider: "none", providerModel: null, latencyMs, inputTokens: 0, costUsd: null,
});

/**
 * Starts the decision without awaiting it, so the caller can run read-only
 * preparation concurrently. In `off` mode nothing is called at all.
 */
export function beginSystemOne(input: Omit<DecisionInput, "tools"> & {
  trace: RequestTrace;
  signal?: AbortSignal;
}): SystemOneTurn {
  const mode = resolveAgentMode(input.agentId);
  if (mode === "off") return { mode, tools: [], result: Promise.resolve(disabled()) };

  const { service, config } = getSystemOne();
  const tools = peekReadOnlyTools(input.agentId);
  input.trace.mark("s1_start");
  const result = service
    .decide({ ...input, tools }, { timeoutMs: surfaceTimeoutMs(config, input.surface), signal: input.signal })
    .then((r) => {
      input.trace.mark("s1_complete");
      return r;
    });
  return { mode, tools, result };
}

export function planForTurn(turn: SystemOneTurn, result: SystemOneResult, surface: SystemOneSurface, memoryRetrievalSkippable: boolean): RoutingPlan {
  return planRoute({
    decision: result.decision,
    surface,
    config: getSystemOne().config,
    tools: turn.tools,
    memoryRetrievalSkippable,
  });
}

/** Runs the plan's read-only tool. Only ever called for `fast_path_tool` plans. */
export async function runFastPathTool(agentId: string, plan: RoutingPlan, trace: RequestTrace, signal?: AbortSignal): Promise<ToolCallResult> {
  if (plan.action !== "fast_path_tool" || !plan.tool) {
    return { ok: false, data: null, latencyMs: 0, error: "not a fast-path plan" };
  }
  trace.mark("tool_start");
  const result = await callReadOnlyTool({ agentId, toolId: plan.tool.id, arguments: plan.toolArguments, signal });
  trace.mark("tool_complete");
  return result;
}

const MAX_SPOKEN_PAYLOAD_CHARS = 6_000;

/**
 * The structured result handed to the conversational layer. It is data, not
 * an answer written by System 1 — the live layer (or the chat UI) presents it.
 */
export function toolResultPayload(tool: ReadOnlyToolDescriptor, data: unknown) {
  const text = typeof data === "string" ? data : JSON.stringify(data);
  return {
    source: tool.id,
    description: tool.description,
    data: text.length > MAX_SPOKEN_PAYLOAD_CHARS ? `${text.slice(0, MAX_SPOKEN_PAYLOAD_CHARS)}…(truncated)` : text,
  };
}

/**
 * Voice/agent session warm-up. Everything here is read-only and idempotent:
 * the agent's read-only tool catalog (connect + `tools/list`), and one tiny
 * System 1 call to open the provider's keep-alive connection so the first
 * spoken request does not pay TLS and DNS. Failures are ignored — warm-up is
 * an optimisation, never a precondition.
 */
export async function warmSystemOne(agentId: string): Promise<void> {
  const mode = resolveAgentMode(agentId);
  if (mode === "off") return;
  const { service, config } = getSystemOne();
  await Promise.allSettled([
    listReadOnlyTools(agentId),
    config.warmup
      ? service.decide({ request: "hello", surface: "voice", agentId, tools: [] }, { timeoutMs: config.voiceTimeoutMs * 4 })
      : Promise.resolve(),
  ]);
}
