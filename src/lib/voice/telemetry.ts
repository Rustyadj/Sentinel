/**
 * Per-session telemetry for live voice.
 *
 * A live conversation spends money in two different currencies: wall-clock
 * minutes on the live audio layer, and tokens on the agent's own reasoning
 * model. They are billed by different vendors at different rates, so this
 * keeps them apart rather than reporting one blended figure that answers
 * neither "why was voice expensive" nor "which agent is expensive".
 */
import { db } from "@/lib/db";
import { calculateModelCost, type ReportedTokenUsage } from "@/lib/agents/pricing";

export interface StartVoiceSessionInput {
  userId: string;
  agentId: string;
  roomId: string | null;
  voiceModel: string;
  reasoningModel: string;
}

export async function startVoiceSessionTelemetry(input: StartVoiceSessionInput): Promise<string> {
  const row = await db.voiceSessionTelemetry.create({
    data: {
      userId: input.userId,
      agentId: input.agentId,
      roomId: input.roomId,
      voiceModel: input.voiceModel,
      reasoningModel: input.reasoningModel,
    },
    select: { id: true },
  });
  return row.id;
}

export interface ReasoningTurnTelemetry {
  sessionId: string;
  /** Round-trip for the reasoning call, in milliseconds. */
  latencyMs: number;
  inputTokens?: number;
  outputTokens?: number;
  /** Tool executions performed while answering this turn. */
  toolCalls?: number;
}

/**
 * Folds one reasoning turn into the session row.
 *
 * Written as a single atomic update rather than read-modify-write: turns can
 * overlap when a user interrupts and the previous turn is still settling, and
 * two concurrent increments must not lose one another.
 */
export async function recordReasoningTurn(turn: ReasoningTurnTelemetry): Promise<void> {
  const latency = Math.max(0, Math.round(turn.latencyMs));
  await db.$transaction(async (tx) => {
    const current = await tx.voiceSessionTelemetry.findUnique({
      where: { id: turn.sessionId },
      select: { latencyMsMax: true },
    });
    if (!current) return;
    await tx.voiceSessionTelemetry.update({
      where: { id: turn.sessionId },
      data: {
        reasoningInputTokens: { increment: Math.max(0, turn.inputTokens ?? 0) },
        reasoningOutputTokens: { increment: Math.max(0, turn.outputTokens ?? 0) },
        toolCallCount: { increment: Math.max(0, turn.toolCalls ?? 0) },
        latencyMsTotal: { increment: latency },
        latencySamples: { increment: 1 },
        latencyMsMax: latency > current.latencyMsMax ? latency : undefined,
      },
    });
  });
}

/**
 * Closes the session and prices it.
 *
 * Cost stays null when the reasoning model has no rate card entry. An
 * unpriced model reporting zero would read as "this was free", which is a
 * more damaging answer than "unknown".
 */
export async function finishVoiceSessionTelemetry(sessionId: string): Promise<void> {
  const session = await db.voiceSessionTelemetry.findUnique({
    where: { id: sessionId },
    select: {
      startedAt: true,
      endedAt: true,
      reasoningModel: true,
      reasoningInputTokens: true,
      reasoningOutputTokens: true,
    },
  });
  if (!session || session.endedAt) return;

  const endedAt = new Date();
  const liveSeconds = Math.max(0, Math.round((endedAt.getTime() - session.startedAt.getTime()) / 1000));

  const usage: ReportedTokenUsage = {
    inputTokens: session.reasoningInputTokens,
    outputTokens: session.reasoningOutputTokens,
    cachedInputTokens: 0,
    cacheWrite5mInputTokens: 0,
    cacheWrite1hInputTokens: 0,
  };

  await db.voiceSessionTelemetry.update({
    where: { id: sessionId },
    data: {
      endedAt,
      liveSeconds,
      estimatedCostUsd: calculateModelCost(session.reasoningModel, usage),
    },
  });
}

export interface VoiceSessionSummary {
  liveSeconds: number;
  reasoningInputTokens: number;
  reasoningOutputTokens: number;
  toolCallCount: number;
  averageLatencyMs: number | null;
  maxLatencyMs: number;
  estimatedCostUsd: number | null;
}

export async function getVoiceSessionSummary(sessionId: string): Promise<VoiceSessionSummary | null> {
  const row = await db.voiceSessionTelemetry.findUnique({ where: { id: sessionId } });
  if (!row) return null;
  return {
    liveSeconds: row.liveSeconds,
    reasoningInputTokens: row.reasoningInputTokens,
    reasoningOutputTokens: row.reasoningOutputTokens,
    toolCallCount: row.toolCallCount,
    averageLatencyMs: row.latencySamples > 0 ? Math.round(row.latencyMsTotal / row.latencySamples) : null,
    maxLatencyMs: row.latencyMsMax,
    estimatedCostUsd: row.estimatedCostUsd,
  };
}
