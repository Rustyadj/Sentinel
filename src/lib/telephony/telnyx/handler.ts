import { redisAcquireLease, redisDel, redisGet, redisSet } from "@/lib/redis";
import { logger } from "@/lib/logger";
import { runVoiceReasoningTurn } from "@/lib/voice/reasoning-bridge";
import { writeAuditLog } from "@/lib/workspaces/audit";
import * as telnyx from "./client";
import { isAllowedCaller, type TelnyxConfig } from "./config";
import type { TelnyxEvent } from "./events";

const EVENT_DEDUPE_TTL_SECONDS = 24 * 60 * 60;
/** Upper bound on a call; the screened-call marker expires with it. */
const CALL_TTL_SECONDS = 4 * 60 * 60;

const SMS_STYLE = "[Reply by SMS: be concise, plain text, no markdown.]";
const VOICE_STYLE = "[Spoken phone call: answer in one to three short sentences, no markdown, no lists.]";
const GREETING = "Sentinel here. How can I help?";
const FAILURE_SPEECH = "Sorry, I hit a problem answering that. Please try again.";

const callKey = (id: string) => `telnyx:call:${id}`;

/** Telnyx redelivers on timeouts. Redis is required: with no Redis the event is dropped rather than risk replying twice. */
async function firstDelivery(eventId: string): Promise<boolean> {
  return redisAcquireLease(`telnyx:event:${eventId}`, "1", EVENT_DEDUPE_TTL_SECONDS);
}

async function ask(config: TelnyxConfig, request: string, style: string, channel: "sms" | "voice") {
  const result = await runVoiceReasoningTurn({
    agentId: config.agentId,
    userId: config.ownerUserId,
    request: `${style}\n${request}`,
  });
  await writeAuditLog({
    userId: config.ownerUserId,
    agentId: config.agentId,
    action: `telephony.${channel}_turn`,
    entityType: "TelnyxChannel",
    details: { toolCalls: result.toolCalls, latencyMs: result.latencyMs },
  }).catch(() => {});
  return result.answer;
}

async function handleSms(config: TelnyxConfig, event: Extract<TelnyxEvent, { kind: "sms" }>) {
  if (!isAllowedCaller(config, event.from)) {
    logger.warn("telnyx.sms_rejected", { eventId: event.id });
    return;
  }
  const text = event.text.trim();
  if (!text) return;
  try {
    const answer = await ask(config, text, SMS_STYLE, "sms");
    await telnyx.sendSms(config, event.from, answer || "I have no answer for that yet.");
  } catch (error) {
    logger.error("telnyx.sms_failed", { eventId: event.id, error: String(error) });
    await telnyx.sendSms(config, event.from, "Sorry, I hit a problem. Please try again.").catch(() => {});
  }
}

async function handleCallInitiated(config: TelnyxConfig, event: Extract<TelnyxEvent, { kind: "call.initiated" }>) {
  if (!isAllowedCaller(config, event.from)) {
    logger.warn("telnyx.call_rejected", { eventId: event.id });
    await telnyx.hangupCall(config, event.callControlId).catch(() => {});
    return;
  }
  // Later events (transcription) are trusted via this marker, not via fields in their own payload.
  await redisSet(callKey(event.callControlId), event.from!, CALL_TTL_SECONDS);
  await telnyx.answerCall(config, event.callControlId);
}

async function handleCallAnswered(config: TelnyxConfig, event: Extract<TelnyxEvent, { kind: "call.answered" }>) {
  if (!(await redisGet(callKey(event.callControlId)))) return;
  await telnyx.startTranscription(config, event.callControlId);
  await telnyx.speak(config, event.callControlId, GREETING);
}

async function handleTranscription(config: TelnyxConfig, event: Extract<TelnyxEvent, { kind: "call.transcription" }>) {
  if (!event.isFinal || !event.transcript.trim()) return;
  if (!(await redisGet(callKey(event.callControlId)))) return;
  try {
    const answer = await ask(config, event.transcript.trim(), VOICE_STYLE, "voice");
    await telnyx.speak(config, event.callControlId, answer || FAILURE_SPEECH);
  } catch (error) {
    logger.error("telnyx.voice_failed", { eventId: event.id, error: String(error) });
    await telnyx.speak(config, event.callControlId, FAILURE_SPEECH).catch(() => {});
  }
}

export async function handleTelnyxEvent(config: TelnyxConfig, event: TelnyxEvent): Promise<void> {
  if (event.kind === "ignored") return;
  if (!(await firstDelivery(event.id))) return;

  try {
    switch (event.kind) {
      case "sms": return await handleSms(config, event);
      case "call.initiated": return await handleCallInitiated(config, event);
      case "call.answered": return await handleCallAnswered(config, event);
      case "call.transcription": return await handleTranscription(config, event);
      case "call.hangup": return await redisDel(callKey(event.callControlId));
    }
  } catch (error) {
    logger.error("telnyx.event_failed", { eventId: event.id, kind: event.kind, error: String(error) });
  }
}
