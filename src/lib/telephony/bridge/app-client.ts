import { logger } from "@/lib/logger";

const TURN_TIMEOUT_MS = 120_000;

function endpoint(): { url: string; secret: string } {
  const secret = process.env.TELNYX_BRIDGE_SECRET;
  if (!secret || secret.length < 32) throw new Error("TELNYX_BRIDGE_SECRET (32+ chars) is required");
  const base = (process.env.SENTINEL_INTERNAL_URL ?? "http://app:3000").replace(/\/$/, "");
  return { url: `${base}/api/telephony/turn`, secret };
}

async function post(body: Record<string, unknown>, signal?: AbortSignal): Promise<Response> {
  const { url, secret } = endpoint();
  const timeout = AbortSignal.timeout(TURN_TIMEOUT_MS);
  return fetch(url, {
    method: "POST",
    headers: { Authorization: `Bearer ${secret}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
  });
}

/** One spoken turn on the agent's own runtime, run by the app (which owns memory, tools and permissions). */
export async function runAgentTurn(callId: string, request: string, signal: AbortSignal): Promise<{ answer: string; toolCalls: number }> {
  const response = await post({ callId, mode: "turn", request }, signal);
  const payload = (await response.json().catch(() => null)) as { answer?: string; toolCalls?: number; error?: string } | null;
  if (!response.ok || typeof payload?.answer !== "string") throw new Error(payload?.error ?? `Sentinel turn failed (${response.status})`);
  return { answer: payload.answer, toolCalls: payload.toolCalls ?? 0 };
}

export async function requestSummary(callId: string): Promise<void> {
  try {
    const response = await post({ callId, mode: "summary" });
    if (!response.ok) logger.warn("telephony.summary_request_failed", { callId, status: response.status });
  } catch (error) {
    logger.warn("telephony.summary_request_failed", { callId, error: String(error) });
  }
}
