import { z } from "zod";

const phone = z.object({ phone_number: z.string() });

const smsPayload = z.object({
  direction: z.string().optional(),
  from: phone,
  text: z.string().default(""),
});

const callPayload = z.object({
  call_control_id: z.string(),
  from: z.string().optional(),
  direction: z.string().optional(),
});

const transcriptionPayload = callPayload.extend({
  transcription_data: z.object({ transcript: z.string(), is_final: z.boolean().optional() }),
});

const envelope = z.object({
  data: z.object({ id: z.string(), event_type: z.string(), payload: z.unknown() }),
});

export type TelnyxEvent =
  | { kind: "sms"; id: string; from: string; text: string }
  | { kind: "call.initiated"; id: string; callControlId: string; from: string | undefined }
  | { kind: "call.answered"; id: string; callControlId: string; from: string | undefined }
  | { kind: "call.transcription"; id: string; callControlId: string; from: string | undefined; transcript: string; isFinal: boolean }
  | { kind: "call.hangup"; id: string; callControlId: string }
  | { kind: "ignored"; id: string; type: string };

/** Parses a webhook body into the small set of events Sentinel acts on. Throws on a malformed envelope. */
export function parseTelnyxEvent(body: unknown): TelnyxEvent {
  const { data } = envelope.parse(body);
  const ignored = { kind: "ignored", id: data.id, type: data.event_type } as const;

  switch (data.event_type) {
    case "message.received": {
      const p = smsPayload.parse(data.payload);
      return { kind: "sms", id: data.id, from: p.from.phone_number, text: p.text };
    }
    case "call.initiated": {
      const p = callPayload.parse(data.payload);
      // Outbound legs we place ourselves are not inbound calls to screen.
      if (p.direction && p.direction !== "incoming") return ignored;
      return { kind: "call.initiated", id: data.id, callControlId: p.call_control_id, from: p.from };
    }
    case "call.answered": {
      const p = callPayload.parse(data.payload);
      return { kind: "call.answered", id: data.id, callControlId: p.call_control_id, from: p.from };
    }
    case "call.hangup": {
      const p = callPayload.parse(data.payload);
      return { kind: "call.hangup", id: data.id, callControlId: p.call_control_id };
    }
    case "call.transcription": {
      const p = transcriptionPayload.parse(data.payload);
      return {
        kind: "call.transcription",
        id: data.id,
        callControlId: p.call_control_id,
        from: p.from,
        transcript: p.transcription_data.transcript,
        isFinal: p.transcription_data.is_final ?? true,
      };
    }
    default:
      return ignored;
  }
}
