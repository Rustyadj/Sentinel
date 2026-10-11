import type { TelnyxConfig } from "./config";

export class TelnyxApiError extends Error {
  constructor(message: string, readonly status: number) {
    super(message);
  }
}

const REQUEST_TIMEOUT_MS = 10_000;
/** Telnyx rejects SMS bodies beyond this; long agent answers are truncated rather than failing the send. */
export const MAX_SMS_CHARS = 1_500;

async function post(config: TelnyxConfig, path: string, body: Record<string, unknown>): Promise<unknown> {
  const response = await fetch(`${config.apiBase}${path}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });
  if (!response.ok) {
    // Telnyx error bodies carry no credentials; the status plus first error title is enough to act on.
    const detail = await response.json().then((j: { errors?: { title?: string }[] }) => j.errors?.[0]?.title).catch(() => undefined);
    throw new TelnyxApiError(`Telnyx ${path} failed (${response.status})${detail ? `: ${detail}` : ""}`, response.status);
  }
  return response.json().catch(() => ({}));
}

export function truncateForSms(text: string): string {
  return text.length <= MAX_SMS_CHARS ? text : `${text.slice(0, MAX_SMS_CHARS - 1)}…`;
}

export function sendSms(config: TelnyxConfig, to: string, text: string) {
  return post(config, "/messages", { from: config.fromNumber, to, text: truncateForSms(text) });
}

const callAction = (config: TelnyxConfig, callControlId: string, action: string, body: Record<string, unknown> = {}) =>
  post(config, `/calls/${encodeURIComponent(callControlId)}/actions/${action}`, body);

export const answerCall = (config: TelnyxConfig, id: string) => callAction(config, id, "answer");
export const hangupCall = (config: TelnyxConfig, id: string) => callAction(config, id, "hangup");
export const speak = (config: TelnyxConfig, id: string, text: string) =>
  callAction(config, id, "speak", { payload: text, voice: "female", language: "en-US" });
export const startTranscription = (config: TelnyxConfig, id: string) =>
  callAction(config, id, "transcription_start", { language: "en" });
