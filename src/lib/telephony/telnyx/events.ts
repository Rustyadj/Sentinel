import { z } from "zod";

const phone = z.object({ phone_number: z.string() });

const smsPayload = z.object({
  id: z.string().optional(),
  direction: z.string().optional(),
  from: phone,
  to: z.array(phone).default([]),
  text: z.string().nullish().transform((v) => v ?? ""),
  media: z.array(z.object({ url: z.string() })).default([]),
});

const deliveryPayload = z.object({
  id: z.string(),
  to: z.array(z.object({ status: z.string().optional() })).default([]),
});

const callPayload = z.object({
  call_control_id: z.string(),
  call_session_id: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  direction: z.string().optional(),
  hangup_cause: z.string().optional(),
});

const envelope = z.object({
  data: z.object({ id: z.string(), event_type: z.string(), payload: z.unknown() }),
});

export type TelnyxEvent =
  | { kind: "sms"; id: string; messageId: string | undefined; from: string; to: string | undefined; text: string; mediaUrls: string[] }
  | { kind: "sms.status"; id: string; messageId: string; status: string }
  | { kind: "call.initiated"; id: string; callControlId: string; sessionId: string | undefined; from: string | undefined; to: string | undefined }
  | { kind: "call.hangup"; id: string; callControlId: string; cause: string | undefined }
  | { kind: "ignored"; id: string; type: string };

/** Parses a webhook body into the small set of events Sentinel acts on. Throws on a malformed envelope. */
export function parseTelnyxEvent(body: unknown): TelnyxEvent {
  const { data } = envelope.parse(body);
  const ignored = { kind: "ignored", id: data.id, type: data.event_type } as const;

  switch (data.event_type) {
    case "message.received": {
      const p = smsPayload.parse(data.payload);
      return {
        kind: "sms", id: data.id, messageId: p.id, from: p.from.phone_number,
        to: p.to[0]?.phone_number, text: p.text, mediaUrls: p.media.map((m) => m.url),
      };
    }
    case "message.finalized": {
      const p = deliveryPayload.parse(data.payload);
      return { kind: "sms.status", id: data.id, messageId: p.id, status: p.to[0]?.status ?? "unknown" };
    }
    case "call.initiated": {
      const p = callPayload.parse(data.payload);
      // Legs we dial ourselves are tracked by our own row, not screened as inbound.
      if (p.direction && p.direction !== "incoming") return ignored;
      return { kind: "call.initiated", id: data.id, callControlId: p.call_control_id, sessionId: p.call_session_id, from: p.from, to: p.to };
    }
    case "call.hangup": {
      const p = callPayload.parse(data.payload);
      return { kind: "call.hangup", id: data.id, callControlId: p.call_control_id, cause: p.hangup_cause };
    }
    default:
      return ignored;
  }
}
