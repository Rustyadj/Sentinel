import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { resolveAgentVoiceConfig } from "@/lib/voice/agent-voice-config";
import { runVoiceReasoningTurn } from "@/lib/voice/reasoning-bridge";
import { recordReasoningTurn } from "@/lib/voice/telemetry";
import { RequestTrace, recordDecision, type ExecutedPath } from "@/lib/system-one/telemetry";
import { beginSystemOne, planForTurn, runFastPathTool, toolResultPayload } from "@/lib/system-one/turn";
import type { RoutingPlan, SystemOneResult } from "@/lib/system-one/types";

export const runtime = "nodejs";

/**
 * Where the live layer's `sentinel_reasoning` tool call lands.
 *
 * The live model has no reasoning authority of its own: it hands the turn
 * here, and this runs it through the agent's configured brain on the same
 * runtime a typed message uses. The answer goes back to be spoken.
 *
 * Nothing about which model runs is taken from the request. The agent is
 * named, and the agent's configuration decides the rest — a caller cannot
 * ask for one agent's voice and another's brain.
 */
export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { agentId?: string; roomId?: string; request?: string; sessionId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  const config = resolveAgentVoiceConfig(body.agentId);
  if (!config) {
    return NextResponse.json({ error: "Unknown voice agent" }, { status: 400 });
  }

  const request = body.request?.trim();
  if (!request) {
    return NextResponse.json({ error: "A request is required" }, { status: 400 });
  }

  // Same binding the session route enforces: the conversation must belong to
  // this user and to this agent. Without it, a session opened as one agent
  // could read and append to the other's conversation.
  if (body.roomId) {
    const room = await db.chatRoom.findFirst({
      where: { id: body.roomId, userId: user.id },
      select: { id: true, agentIds: true },
    });
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (!room.agentIds?.includes(config.agentId)) {
      return NextResponse.json(
        { error: "That conversation does not belong to this agent" },
        { status: 403 },
      );
    }
  }

  // ── System 1 ───────────────────────────────────────────────────────────
  // `req.signal` aborts when the client drops the call — which is what an
  // interruption does — so both the decision and any runtime turn stop.
  const trace = new RequestTrace();
  const signal = req.signal;
  const decisionId = crypto.randomUUID();
  const s1 = beginSystemOne({
    surface: "voice",
    agentId: config.agentId,
    request,
    configuredModel: config.reasoningModel,
    trace,
    signal,
  });

  let plan: RoutingPlan | null = null;
  let s1Result: SystemOneResult | null = null;
  let executedPath: ExecutedPath = "system2";
  let toolRecord: { id: string; ok: boolean; latencyMs: number } | null = null;

  if (s1.mode === "active") {
    // Active: the decision is awaited, bounded by the voice timeout (default
    // 250ms), because it decides whether System 2 runs at all. System 2 is
    // never started speculatively — a runtime turn can take write actions.
    s1Result = await s1.result;
    plan = planForTurn(s1, s1Result, "voice", false);
    trace.mark("routing_complete");

    if (plan.action === "fast_path_tool" && plan.tool) {
      const tool = await runFastPathTool(config.agentId, plan, trace, signal);
      toolRecord = { id: plan.tool.id, ok: tool.ok, latencyMs: tool.latencyMs };
      if (tool.ok) {
        trace.mark("response_first_token");
        trace.mark("request_complete");
        const payload = toolResultPayload(plan.tool, tool.data);
        void recordDecision({
          id: decisionId, surface: "voice", agentId: config.agentId, userId: user.id, roomId: body.roomId,
          mode: s1.mode, result: s1Result, plan, executedPath: "fast_path_tool", system2Invoked: false,
          tool: toolRecord, trace,
        });
        if (body.sessionId) {
          await recordReasoningTurn({ sessionId: body.sessionId, latencyMs: trace.elapsed(), inputTokens: 0, outputTokens: 0, toolCalls: 1 }).catch(() => {});
        }
        return NextResponse.json({
          // Data for the live layer to present — not an answer System 1 wrote.
          answer: `Result from ${payload.description}: ${payload.data}`,
          structured: payload,
          fastPath: true,
          decisionId,
          agentId: config.agentId,
          reasoningModel: config.reasoningModel,
          executedModel: null,
          latencyMs: trace.elapsed(),
          toolCalls: 1,
        });
      }
      // A failed fast path is a fallback, never a failed turn.
      executedPath = "fast_path_failed";
    }
  }

  // Interrupted while System 1 was deciding: never start a runtime turn
  // (session, audit, prompt to the agent) only to cancel it.
  if (signal.aborted) {
    const finalResult = s1Result ?? await s1.result;
    void recordDecision({
      id: decisionId, surface: "voice", agentId: config.agentId, userId: user.id, roomId: body.roomId,
      mode: s1.mode, result: finalResult, plan, executedPath, system2Invoked: false, tool: toolRecord, trace, interrupted: true,
    });
    return NextResponse.json({ error: "Cancelled by a newer utterance" }, { status: 499 });
  }

  let result;
  trace.mark("system2_start");
  try {
    result = await runVoiceReasoningTurn({
      agentId: config.agentId,
      userId: user.id,
      roomId: body.roomId,
      request,
      signal,
      onFirstText: () => trace.mark("system2_first_token"),
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reasoning failed";
    return NextResponse.json({ error: message.slice(0, 240) }, { status: 502 });
  }
  trace.mark("system2_complete");
  trace.mark("response_first_token");
  trace.mark("request_complete");

  // Shadow (and off, as the measured baseline): the decision ran alongside
  // System 2 and is recorded once both have finished. It added no latency.
  void (async () => {
    const finalResult = s1Result ?? await s1.result;
    const finalPlan = plan ?? (s1.mode === "off" ? null : planForTurn(s1, finalResult, "voice", false));
    await recordDecision({
      id: decisionId, surface: "voice", agentId: config.agentId, userId: user.id, roomId: body.roomId,
      mode: s1.mode, result: finalResult, plan: finalPlan, executedPath, system2Invoked: true,
      tool: toolRecord, trace, interrupted: result.cancelled,
      system2: { model: result.executedModel, inputTokens: result.inputTokens, outputTokens: result.outputTokens, tools: result.toolNames },
    });
  })();

  if (result.cancelled) {
    return NextResponse.json({ error: "Cancelled by a newer utterance" }, { status: 499 });
  }

  if (body.sessionId) {
    // Telemetry must never cost the user their answer.
    await recordReasoningTurn({
      sessionId: body.sessionId,
      latencyMs: result.latencyMs,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      toolCalls: result.toolCalls,
    }).catch(() => {});
  }

  return NextResponse.json({
    answer: result.answer,
    decisionId,
    agentId: config.agentId,
    reasoningModel: config.reasoningModel,
    executedModel: result.executedModel,
    latencyMs: result.latencyMs,
    toolCalls: result.toolCalls,
  });
}
