import { db } from "@/lib/db";
import { resolveAgentVoiceConfig } from "@/lib/voice/agent-voice-config";
import { writeAuditLog } from "@/lib/workspaces/audit";
import * as telnyx from "../telnyx/client";
import { loadTelnyxConfig, type TelnyxConfig } from "../telnyx/config";
import { resolveDestination } from "./contacts";
import { assertDialable, CallPolicyError, enforceOutboundRateLimit } from "./policy";

const MAX_MEDIA = 10;

/** Sends an SMS/MMS as the named agent, subject to the same destination and rate rules as calls. */
export async function sendAgentMessage(
  input: { userId: string; agent: string; target: string; text: string; mediaUrls?: string[] },
  config: TelnyxConfig = loadTelnyxConfig(),
) {
  const voice = resolveAgentVoiceConfig(input.agent);
  if (!voice) throw new CallPolicyError("Unknown agent. Messages can be sent by Lisa or Nathan2.", "unavailable");
  const text = input.text.trim();
  const media = (input.mediaUrls ?? []).slice(0, MAX_MEDIA);
  if (!text && media.length === 0) throw new CallPolicyError("A message needs text or an attachment.", "invalid_number");
  if (media.some((u) => !u.startsWith("https://"))) throw new CallPolicyError("Attachments must be https URLs.", "invalid_number");

  const destination = await resolveDestination(input.userId, input.target);
  assertDialable(config, destination.number);
  await enforceOutboundRateLimit(config, input.userId);

  const sent = await telnyx.sendSms(config, destination.number, text, media);
  const message = await db.phoneMessage.create({
    data: {
      userId: input.userId, agentId: voice.agentId, direction: "outbound", counterparty: destination.number,
      fromNumber: config.fromNumber, toNumber: destination.number, text, mediaUrls: media,
      telnyxMessageId: sent.data?.id ?? null, status: "sent",
    },
  });
  await writeAuditLog({
    userId: input.userId, agentId: voice.agentId, action: "telephony.sms_sent", entityType: "PhoneMessage",
    entityId: message.id, details: { to: destination.number, media: media.length },
  }).catch(() => {});
  return message;
}
