/**
 * Confidence-gated routing. The only place a System 1 decision becomes an
 * action — and confidence here controls *routing*, never truth: a confident
 * decision can at most pick a read-only tool whose own output is the answer,
 * or skip a memory fetch the request does not need. Nothing is ever answered
 * from System 1's judgement alone.
 *
 * Tiers (route confidence against the configured band):
 *   high   → act: fast-path a read-only tool, or skip memory retrieval
 *   medium → today's path, which already gathers memory and uses the agent's
 *            own model (ADR-004: there is no cheaper model to fall to)
 *   low    → today's path, decision ignored
 */
import type { SystemOneConfig } from "./config";
import type {
  ConfidenceTier,
  ReadOnlyToolDescriptor,
  RoutingPlan,
  SystemOneDecision,
  SystemOneIntent,
  SystemOneSurface,
} from "./types";

/** Intents that are never fast-pathed regardless of confidence. */
const NEVER_FAST_PATH: ReadonlySet<SystemOneIntent> = new Set(["write_action", "coding", "task_orchestration", "multi_step_reasoning", "web_search"]);

export interface PlanInput {
  decision: SystemOneDecision | null;
  surface: SystemOneSurface;
  config: Pick<SystemOneConfig, "thresholds" | "fastPathSurfaces">;
  /** The same authorized, read-only list the decision was asked over. */
  tools: ReadOnlyToolDescriptor[];
  /** Whether this surface performs its own memory retrieval that could be skipped. */
  memoryRetrievalSkippable: boolean;
}

export function confidenceTier(confidence: number, band: { high: number; low: number }): ConfidenceTier {
  if (confidence >= band.high) return "high";
  if (confidence >= band.low) return "medium";
  return "low";
}

const todaysPath = (tier: ConfidenceTier, reasons: string[]): RoutingPlan => ({ action: "system2", tier, tool: null, toolArguments: {}, reasons });

export function planRoute(input: PlanInput): RoutingPlan {
  const { decision, config } = input;
  if (!decision) return todaysPath("low", ["no decision: fallback to existing routing"]);

  const tier = confidenceTier(decision.confidence, config.thresholds.route);
  if (tier !== "high") return todaysPath(tier, [`route confidence ${decision.confidence.toFixed(2)} is ${tier}`]);

  const yes = config.thresholds.noul;
  const no = 1 - yes;
  const reasons: string[] = [];

  // ── Read-only tool fast path ────────────────────────────────────────────
  const tool = decision.suggestedTool ? input.tools.find((t) => t.id === decision.suggestedTool) ?? null : null;
  const blockers: string[] = [];
  if (!config.fastPathSurfaces.has(input.surface)) blockers.push(`fast path disabled on ${input.surface}`);
  if (decision.route !== "tool_read") blockers.push(`route is ${decision.route}`);
  if (NEVER_FAST_PATH.has(decision.intent)) blockers.push(`intent ${decision.intent} never fast-paths`);
  if (!tool) blockers.push("no authorized tool chosen");
  else {
    if (!tool.fastPathEligible) blockers.push(`${tool.id} has a required argument System 1 cannot fill`);
    const toolConfidence = decision.confidences.tool ?? 0;
    if (toolConfidence < config.thresholds.tool.high) blockers.push(`tool confidence ${toolConfidence.toFixed(2)} below ${config.thresholds.tool.high}`);
    const missing = tool.requiredArguments.filter((a) => !(a in decision.suggestedToolArguments));
    if (missing.length) blockers.push(`unfilled required arguments: ${missing.join(", ")}`);
  }
  if (decision.readOnly < yes) blockers.push(`read-only ${decision.readOnly.toFixed(2)} below ${yes}`);
  if (decision.needsSystem2 > no) blockers.push(`needsSystem2 ${decision.needsSystem2.toFixed(2)}`);
  if (decision.needsClarification > no) blockers.push(`needsClarification ${decision.needsClarification.toFixed(2)}`);
  if (decision.needsSearch > no) blockers.push(`needsSearch ${decision.needsSearch.toFixed(2)}`);

  if (blockers.length === 0 && tool) {
    return {
      action: "fast_path_tool",
      tier,
      tool,
      toolArguments: Object.fromEntries(Object.entries(decision.suggestedToolArguments).filter(([k]) => k in tool.enumArguments)),
      reasons: [`read-only ${tool.id} answers it; no System 2`],
    };
  }
  reasons.push(...blockers.map((b) => `no fast path: ${b}`));

  // ── Memory skip (only where Sentinel itself retrieves) ──────────────────
  if (
    input.memoryRetrievalSkippable
    && decision.needsMemory <= no
    && decision.route !== "memory_answer"
    && decision.intent !== "memory_recall"
  ) {
    return { action: "system2_skip_memory", tier, tool: null, toolArguments: {}, reasons: [...reasons, `needsMemory ${decision.needsMemory.toFixed(2)}: skip retrieval`] };
  }

  return todaysPath(tier, reasons);
}
