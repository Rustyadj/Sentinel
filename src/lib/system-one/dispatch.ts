/** Shared System-1 boundary. Call only after the existing caller authorization,
 * before retrieving memory or dispatching a prompt. Never grants capabilities. */
import { AsyncLocalStorage } from "node:async_hooks";
import { beginSystemOne, planForTurn } from "./turn";
import { RequestTrace, recordDecision } from "./telemetry";
import { logger } from "@/lib/logger";
import type { SystemOneSurface } from "./types";

// Voice already owns a System-1 turn and its telemetry. Reuse that decision
// only within its server-owned async call scope, never from request parameters.
const classifiedTurn = new AsyncLocalStorage<{ agentId: string; userId: string; request: string }>();
export function withClassifiedTurn<T>(identity: { agentId: string; userId: string; request: string }, run: () => Promise<T>): Promise<T> {
  return classifiedTurn.run(identity, run);
}

export async function classifyDispatch(input: {
  agentId: string; userId: string; request: string; surface: SystemOneSurface;
  configuredModel?: string | null; roomId?: string | null; executionRef?: string;
  memoryRetrievalSkippable?: boolean;
}) {
  const parent = classifiedTurn.getStore();
  if (parent?.agentId === input.agentId && parent.userId === input.userId && parent.request === input.request) return { skipMemory: false, recordId: null };
  const trace = new RequestTrace();
  const turn = beginSystemOne({ ...input, trace, routingOnly: true });
  const result = await turn.result;
  const plan = planForTurn(turn, result, input.surface, input.memoryRetrievalSkippable ?? false);
  // Agent/model are server-resolved constraints, never predictions to execute.
  const skipMemory = turn.mode === "active" && plan.action === "system2_skip_memory";
  trace.mark("routing_complete");
  const recordId = await recordDecision({ surface: input.surface, agentId: input.agentId, userId: input.userId,
    roomId: input.roomId, mode: turn.mode, result, plan, trace,
    executedPath: skipMemory ? "system2_skip_memory" : "system2", system2Invoked: false,
    memorySkipped: skipMemory, system2: { model: input.configuredModel ?? null, inputTokens: 0, outputTokens: 0, tools: [] },
  });
  logger.info("system_one.dispatch", { decisionId: recordId, executionRef: input.executionRef, agentId: input.agentId,
    model: input.configuredModel, mode: turn.mode, outcome: result.outcome, latencyMs: result.latencyMs,
    intent: result.decision?.intent, route: result.decision?.route, action: skipMemory ? "system2_skip_memory" : "system2" });
  return { skipMemory, recordId, trace };
}

/** Observe the existing stream; do not alter prompts, models, approvals or events. */
export async function* observeDispatch(routing: { recordId: string | null; trace?: RequestTrace }, events: AsyncIterable<import("@/lib/agents/runtime/types").RuntimeEvent>) {
  const { db } = await import("@/lib/db");
  const tools: string[] = [];
  let model: string | undefined;
  let inputTokens: number | undefined;
  let outputTokens: number | undefined;
  const started = performance.now();
  const persist = (data: object) => routing.recordId
    ? db.systemOneDecision.update({ where: { id: routing.recordId }, data }).catch(() => undefined)
    : Promise.resolve();
  routing.trace?.mark("system2_start");
  await persist({ system2Invoked: true });
  try {
    for await (const event of events) {
      const d = event.data;
      if (event.type === "assistant_delta") { routing.trace?.mark("system2_first_token"); routing.trace?.mark("response_first_token"); }
      if (event.type === "tool_started" && typeof d.name === "string") tools.push(d.name);
      const usage = (d.usage ?? d) as Record<string, unknown>;
      const count = (v: unknown) => typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : undefined;
      inputTokens = count(usage.inputTokens ?? usage.input_tokens ?? usage.promptTokens) ?? inputTokens;
      outputTokens = count(usage.outputTokens ?? usage.output_tokens ?? usage.completionTokens) ?? outputTokens;
      if (typeof (d.actualModel ?? d.model) === "string") model = String(d.actualModel ?? d.model);
      yield event;
    }
  } finally {
    routing.trace?.mark("system2_complete");
    routing.trace?.mark("request_complete");
    await persist({ ...(routing.trace ? { phases: routing.trace.phases } : {}), system2Tools: tools, ...(model ? { system2Model: model } : {}),
      ...(inputTokens !== undefined ? { system2InputTokens: inputTokens } : {}),
      ...(outputTokens !== undefined ? { system2OutputTokens: outputTokens } : {}),
      totalLatencyMs: routing.trace?.elapsed() ?? Math.round(performance.now() - started),
    });
  }
}
