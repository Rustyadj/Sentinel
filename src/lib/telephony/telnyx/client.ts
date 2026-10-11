import type { TelnyxConfig } from "./config";

export class TelnyxApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
/** Telnyx rejects SMS bodies beyond this; long agent answers are truncated rather than failing the send. */
export const MAX_SMS_CHARS = 1_500;

interface RequestOptions {
  /** Telnyx de-duplicates on this header for call commands, so a retried request cannot dial twice. */
  idempotencyKey?: string;
}

async function post<T = unknown>(config: TelnyxConfig, path: string, body: Record<string, unknown>, opts: RequestOptions = {}): Promise<T> {
  const response = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.apiKey}`,
      "Content-Type": "application/json",
      ...(opts.idempotencyKey ? { "Idempotency-Key": opts.idempotencyKey } : {}),
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Telnyx error bodies carry no credentials; the status plus first error title is enough to act on.
    const detail = await response.json().then((j: { errors?: { title?: string }[] }) => j.errors?.[0]?.title).catch(() => undefined);
    throw new TelnyxApiError(`Telnyx ${path} failed (${response.status})${detail ? `: ${detail}` : ""}`, response.status);
  }
  return (await response.json().catch(() => ({}))) as T;
}

export function truncateForSms(text: string): string {
  return text.length <= MAX_SMS_CHARS ? text : `${text.slice(0, MAX_SMS_CHARS - 1)}…`;
}

export interface SmsResult { data?: { id?: string } }

export function sendSms(config: TelnyxConfig, to: string, text: string, mediaUrls: string[] = []) {
  return post<SmsResult>(config, "/messages", {
    from: config.fromNumber,
    to,
    text: truncateForSms(text),
    ...(mediaUrls.length > 0 ? { media_urls: mediaUrls, type: "MMS" } : {}),
  });
}

/** Bidirectional G.711 μ-law at 8 kHz: the phone leg's native codec, which GPT-Live accepts without transcoding. */
export function streamParams(streamUrl: string) {
  return {
    stream_url: streamUrl,
    stream_track: "inbound_track",
    stream_bidirectional_mode: "rtp",
    stream_bidirectional_codec: "PCMU",
  } as const;
}

export interface DialResult { data?: { call_control_id?: string; call_session_id?: string } }

export function dial(config: TelnyxConfig & { connectionId: string }, input: { to: string; streamUrl: string; clientState: string; idempotencyKey: string }) {
  return post<DialResult>(config, "/calls", {
    connection_id: config.connectionId,
    to: input.to,
    from: config.fromNumber,
    client_state: input.clientState,
    // Ring for no longer than a voicemail pickup; an unanswered call must not hold a slot.
    timeout_secs: 30,
    ...streamParams(input.streamUrl),
  }, { idempotencyKey: input.idempotencyKey });
}

const callAction = (config: TelnyxConfig, callControlId: string, action: string, body: Record<string, unknown> = {}) =>
  post(config, `/calls/${encodeURIComponent(callControlId)}/actions/${action}`, body);

export const answerCallWithStream = (config: TelnyxConfig, id: string, streamUrl: string, clientState: string) =>
  callAction(config, id, "answer", { client_state: clientState, ...streamParams(streamUrl) });
export const hangupCall = (config: TelnyxConfig, id: string) => callAction(config, id, "hangup");
export const rejectCall = (config: TelnyxConfig, id: string) => callAction(config, id, "reject", { cause: "USER_BUSY" });
