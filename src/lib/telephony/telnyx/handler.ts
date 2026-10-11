import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redisAcquireLease } from "@/lib/redis";
import { resolveAgentVoiceConfig } from "@/lib/voice/agent-voice-config";
import { runVoiceReasoningTurn } from "@/lib/voice/reasoning-bridge";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { acceptInboundCall, countActiveCalls, statusForHangup } from "../calls/service";
import { ensurePhoneRoom } from "../bridge/phone-room";
import * as telnyx from "./client";
import { isTrustedNumber, normalizeE164, type TelnyxConfig } from "./config";
import type { TelnyxEvent } from "./events";

const EVENT_DEDUPE_TTL_SECONDS = 24 * 60 * 60;
const SMS_STYLE = "[Reply by SMS: be concise, plain text, no markdown.]";

/** Telnyx redelivers on timeouts. Redis is required: with no Redis the event is dropped rather than risk acting twice. */
async function firstDelivery(eventId: string): Promise<boolean> {
  return redisAcquireLease(`telnyx:event:${eventId}`, "1", EVENT_DEDUPE_TTL_SECONDS);
}

function agentForNumber(config: TelnyxConfig, dialed: string | undefined): string {
  return (dialed && config.numberRoutes[normalizeE164(dialed)]) || config.agentId;
}

async function handleSms(config: TelnyxConfig, event: Extract<TelnyxEvent, { kind: "sms" }>) {
  const from = normalizeE164(event.from);
  const trusted = isTrustedNumber(config, from);
  const voice = resolveAgentVoiceConfig(agentForNumber(config, event.to));
  if (!voice) {
    logger.error("telnyx.sms_no_agent", { eventId: event.id });
    return;
  }

  // Stored whatever the sender, so the owner can see who texted; only trusted senders reach the agent.
  const hasContent = event.text.trim() || event.mediaUrls.length > 0;
  if (!hasContent) return;
  try {
    await db.phoneMessage.create({
      data: {
        userId: config.ownerUserId, agentId: voice.agentId, direction: "inbound", counterparty: from,
        fromNumber: from, toNumber: normalizeE164(event.to ?? config.fromNumber), text: event.text,
        mediaUrls: event.mediaUrls, telnyxMessageId: event.messageId ?? null,
        status: "received", trust: trusted ? "trusted" : "screened",
      },
    });
  } catch (error) {
    // A repeated telnyxMessageId means this message was already stored and handled.
    if ((error as { code?: string }).code === "P2002") return;
    throw error;
  }

  if (!trusted) {
    logger.warn("telnyx.sms_screened", { eventId: event.id });
    return;
  }

  const roomId = await ensurePhoneRoom(config.ownerUserId, voice.agentId);
  const attachments = event.mediaUrls.length > 0 ? `\n[Attachments: ${event.mediaUrls.join(" ")}]` : "";
  const outcome = await runVoiceReasoningTurn({
    agentId: voice.agentId,
    userId: config.ownerUserId,
    roomId,
    request: `${SMS_STYLE}\n${event.text.trim()}${attachments}`,
  });
  const reply = outcome.answer || "I have no answer for that yet.";
  const sent = await telnyx.sendSms(config, from, reply);
  await db.phoneMessage.create({
    data: {
      userId: config.ownerUserId, agentId: voice.agentId, direction: "outbound", counterparty: from,
      fromNumber: config.fromNumber, toNumber: from, text: reply, telnyxMessageId: sent.data?.id ?? null, status: "sent",
    },
  });
  await writeAuditLog({
    userId: config.ownerUserId, agentId: voice.agentId, action: "telephony.sms_turn", entityType: "PhoneMessage",
    details: { toolCalls: outcome.toolCalls },
  }).catch(() => {});
}

async function handleCallInitiated(config: TelnyxConfig, event: Extract<TelnyxEvent, { kind: "call.initiated" }>) {
  const from = event.from ? normalizeE164(event.from) : "";
  const to = normalizeE164(event.to ?? config.fromNumber);
  const trusted = isTrustedNumber(config, from);

  if (!from || (!trusted && config.unknownCallers === "reject")) {
    logger.warn("telnyx.call_rejected", { eventId: event.id });
    await telnyx.rejectCall(config, event.callControlId).catch(() => {});
    return;
  }
  if ((await countActiveCalls()) >= config.maxConcurrentCalls) {
    logger.warn("telnyx.call_busy", { eventId: event.id });
    await telnyx.rejectCall(config, event.callControlId).catch(() => {});
    return;
  }
  try {
    await acceptInboundCall(config, { callControlId: event.callControlId, sessionId: event.sessionId, from, to }, trusted);
  } catch (error) {
    logger.error("telnyx.call_accept_failed", { eventId: event.id, error: String(error) });
    await telnyx.rejectCall(config, event.callControlId).catch(() => {});
  }
}

async function handleHangup(event: Extract<TelnyxEvent, { kind: "call.hangup" }>) {
  const call = await db.phoneCall.findUnique({ where: { telnyxCallControlId: event.callControlId } });
  if (!call) return;
  const status = statusForHangup(event.cause, Boolean(call.answeredAt));
  // The bridge finalizes answered calls; this settles calls that never connected media.
  await db.phoneCall.updateMany({
    where: { id: call.id, status: { in: ["queued", "ringing", "active"] }, answeredAt: null },
    data: { status, endedAt: new Date(), endReason: event.cause ?? "hangup" },
  });
  if (call.answeredAt) {
    await db.phoneCall.updateMany({ where: { id: call.id, endReason: null }, data: { endReason: event.cause ?? "hangup" } });
  }
}

export async function handleTelnyxEvent(config: TelnyxConfig, event: TelnyxEvent): Promise<void> {
  if (event.kind === "ignored") return;
  if (!(await firstDelivery(event.id))) return;

  try {
    switch (event.kind) {
      case "sms": return await handleSms(config, event);
      case "sms.status":
        await db.phoneMessage.updateMany({ where: { telnyxMessageId: event.messageId }, data: { status: event.status } });
        return;
      case "call.initiated": return await handleCallInitiated(config, event);
      case "call.hangup": return await handleHangup(event);
    }
  } catch (error) {
    logger.error("telnyx.event_failed", { eventId: event.id, kind: event.kind, error: String(error) });
    if (event.kind === "sms") {
      await telnyx.sendSms(config, normalizeE164(event.from), "Sorry, I hit a problem. Please try again.").catch(() => {});
    }
  }
}
