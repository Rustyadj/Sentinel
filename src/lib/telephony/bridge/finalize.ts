import { db } from "@/lib/db";
import { requestSummary } from "./app-client";
import { writeAuditLog } from "@/lib/workspaces/audit";
import type { RecordedTurn } from "./transcript";

const ACTIVE = ["queued", "ringing", "active"];

export async function markCallActive(callId: string): Promise<void> {
  await db.phoneCall.updateMany({
    where: { id: callId, status: { in: ["queued", "ringing"] } },
    data: { status: "active", answeredAt: new Date() },
  });
}

export async function recordTurn(callId: string, turn: RecordedTurn): Promise<void> {
  await db.phoneCallTurn.create({ data: { callId, role: turn.role, text: turn.text.slice(0, 4_000), offsetMs: Math.round(turn.offsetMs) } });
}

/**
 * Closes out the call record, then (best effort) asks the app to have the
 * agent write it up. Summarizing happens in the app because that is where the
 * agent runtimes live; this process only holds audio and call state.
 */
export async function finalizeCall(input: {
  callId: string;
  reason: string;
  liveSessionId: string | null;
  toolCalls: number;
  turns: RecordedTurn[];
}): Promise<void> {
  const call = await db.phoneCall.findUnique({ where: { id: input.callId } });
  if (!call) return;

  const endedAt = new Date();
  const startedFrom = call.answeredAt ?? call.startedAt;
  await db.phoneCall.updateMany({
    where: { id: call.id, status: { in: ACTIVE } },
    data: { status: call.answeredAt || input.turns.length > 0 ? "completed" : "failed" },
  });
  await db.phoneCall.update({
    where: { id: call.id },
    data: {
      endedAt: call.endedAt ?? endedAt,
      durationSeconds: Math.max(0, Math.round((endedAt.getTime() - startedFrom.getTime()) / 1_000)),
      endReason: call.endReason ?? input.reason,
      liveSessionId: input.liveSessionId,
      toolCallCount: input.toolCalls,
    },
  });

  await writeAuditLog({
    userId: call.userId,
    agentId: call.agentId,
    action: "telephony.call_ended",
    entityType: "PhoneCall",
    entityId: call.id,
    details: { direction: call.direction, trust: call.trust, reason: input.reason, toolCalls: input.toolCalls },
  }).catch(() => {});

  await requestSummary(call.id);
}
