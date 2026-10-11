import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { redisAcquireLease } from "@/lib/redis";
import { resolveAgentVoiceConfig } from "@/lib/voice/agent-voice-config";
import { writeAuditLog } from "@/lib/workspaces/audit";
import * as telnyx from "../telnyx/client";
import { loadTelnyxConfig, requireCallingConfig, type TelnyxConfig } from "../telnyx/config";
import { resolveDestination } from "./contacts";
import { mediaStreamUrl } from "./media-token";
import { assertDialable, CallPolicyError, enforceOutboundRateLimit } from "./policy";

const ACTIVE_STATUSES = ["queued", "ringing", "active"];
/** A second request to the same number inside this window is treated as a double submit. */
const DUPLICATE_WINDOW_SECONDS = 60;

export interface PlaceCallInput {
  userId: string;
  /** Any alias the voice config accepts: "lisa", "nathan2", "hermes-lisa"… */
  agent: string;
  /** Phone number or contact name. */
  target: string;
  /** What the agent should accomplish on the call. */
  purpose: string;
  /** Replay-safe key: the same (user, key) always returns the same call. */
  idempotencyKey?: string;
}

export async function countActiveCalls(): Promise<number> {
  return db.phoneCall.count({ where: { status: { in: ACTIVE_STATUSES }, startedAt: { gt: new Date(Date.now() - 6 * 3_600_000) } } });
}

/**
 * Places an outbound call as the named agent. Everything that can refuse does
 * so before Telnyx is contacted; the row exists first so the media bridge can
 * find the call the instant Telnyx connects.
 */
export async function placeOutboundCall(input: PlaceCallInput, config: TelnyxConfig = loadTelnyxConfig()) {
  requireCallingConfig(config);

  const voice = resolveAgentVoiceConfig(input.agent);
  if (!voice) throw new CallPolicyError("Unknown agent. Calls can be placed by Lisa or Nathan2.", "unavailable");
  const purpose = input.purpose.trim();
  if (!purpose) throw new CallPolicyError("A purpose is required so the agent knows what the call is for.", "invalid_number");

  if (input.idempotencyKey) {
    const existing = await db.phoneCall.findUnique({
      where: { userId_idempotencyKey: { userId: input.userId, idempotencyKey: input.idempotencyKey } },
    });
    if (existing) return { call: existing, replayed: true };
  }

  const destination = await resolveDestination(input.userId, input.target);
  assertDialable(config, destination.number);

  // Duplicate-call guard independent of the client key: a model that retries a
  // tool call with a fresh key must still not ring the same person twice.
  const fresh = await redisAcquireLease(`telnyx:dedupe:${input.userId}:${destination.number}`, "1", DUPLICATE_WINDOW_SECONDS);
  if (!fresh) throw new CallPolicyError("A call to that number was just placed.", "duplicate");

  await enforceOutboundRateLimit(config, input.userId);
  if ((await countActiveCalls()) >= config.maxConcurrentCalls) {
    throw new CallPolicyError("All call lines are busy. Try again shortly.", "busy");
  }

  const call = await db.phoneCall.create({
    data: {
      userId: input.userId,
      agentId: voice.agentId,
      direction: "outbound",
      status: "queued",
      trust: "trusted",
      fromNumber: config.fromNumber,
      toNumber: destination.number,
      contactName: destination.contactName,
      purpose,
      idempotencyKey: input.idempotencyKey ?? null,
    },
  });

  try {
    const result = await telnyx.dial(config, {
      to: destination.number,
      streamUrl: mediaStreamUrl(config.mediaWsUrl, config.mediaTokenSecret, call.id),
      clientState: Buffer.from(call.id).toString("base64"),
      idempotencyKey: call.id,
    });
    const updated = await db.phoneCall.update({
      where: { id: call.id },
      data: {
        status: "ringing",
        telnyxCallControlId: result.data?.call_control_id ?? null,
        telnyxCallSessionId: result.data?.call_session_id ?? null,
      },
    });
    await writeAuditLog({
      userId: input.userId,
      agentId: voice.agentId,
      action: "telephony.call_placed",
      entityType: "PhoneCall",
      entityId: call.id,
      details: { to: destination.number, contact: destination.contactName },
    }).catch(() => {});
    return { call: updated, replayed: false };
  } catch (error) {
    await db.phoneCall.update({ where: { id: call.id }, data: { status: "failed", endedAt: new Date(), endReason: "dial_failed" } });
    logger.error("telnyx.dial_failed", { callId: call.id, error: String(error) });
    throw error;
  }
}

/**
 * Inbound call screening. Returns what to do with the call and, for calls that
 * are answered, the persisted row the bridge will load.
 */
export async function acceptInboundCall(
  config: TelnyxConfig,
  event: { callControlId: string; sessionId?: string; from: string; to: string },
  trusted: boolean,
) {
  requireCallingConfig(config);
  const agent = config.numberRoutes[event.to] ?? config.agentId;
  const voice = resolveAgentVoiceConfig(agent);
  if (!voice) throw new CallPolicyError(`Inbound agent "${agent}" is not a voice-enabled agent.`, "unavailable");

  const existing = await db.phoneCall.findUnique({ where: { telnyxCallControlId: event.callControlId } });
  if (existing) return existing;

  const call = await db.phoneCall.create({
    data: {
      userId: config.ownerUserId,
      agentId: voice.agentId,
      direction: "inbound",
      status: "ringing",
      trust: trusted ? "trusted" : "screened",
      fromNumber: event.from,
      toNumber: event.to,
      telnyxCallControlId: event.callControlId,
      telnyxCallSessionId: event.sessionId ?? null,
    },
  });
  await telnyx.answerCallWithStream(
    config,
    event.callControlId,
    mediaStreamUrl(config.mediaWsUrl, config.mediaTokenSecret, call.id),
    Buffer.from(call.id).toString("base64"),
  );
  return call;
}

const END_STATUS: Record<string, string> = { normal: "completed", busy: "busy", no_answer: "no_answer", rejected: "rejected" };

/** Maps Telnyx's hangup cause onto our status vocabulary. */
export function statusForHangup(cause: string | undefined, wasAnswered: boolean): string {
  if (wasAnswered) return "completed";
  const key = (cause ?? "").toLowerCase();
  if (key.includes("busy")) return END_STATUS.busy;
  if (key.includes("timeout") || key.includes("no_answer") || key.includes("no-answer")) return END_STATUS.no_answer;
  if (key.includes("reject") || key.includes("decline")) return END_STATUS.rejected;
  return "failed";
}
