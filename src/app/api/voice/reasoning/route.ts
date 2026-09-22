import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { resolveAgentVoiceConfig } from "@/lib/voice/agent-voice-config";
import { runVoiceReasoningTurn } from "@/lib/voice/reasoning-bridge";
import { recordReasoningTurn } from "@/lib/voice/telemetry";

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

  let result;
  try {
    result = await runVoiceReasoningTurn({
      agentId: config.agentId,
      userId: user.id,
      roomId: body.roomId,
      request,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reasoning failed";
    return NextResponse.json({ error: message.slice(0, 240) }, { status: 502 });
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
    agentId: config.agentId,
    reasoningModel: config.reasoningModel,
    executedModel: result.executedModel,
    latencyMs: result.latencyMs,
    toolCalls: result.toolCalls,
  });
}
