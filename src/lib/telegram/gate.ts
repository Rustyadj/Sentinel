import { randomUUID } from "node:crypto";
import type { HermesWebSocketClient } from "@/lib/agents/runtime/transports/hermes-websocket";
import { RuntimeError } from "@/lib/agents/runtime/errors";

/** Authenticated host command; never an LLM-generated claim or an env-only capability flag. */
export async function verifyTelegramRuntimeGate(client: HermesWebSocketClient, sessionId: string, profile: string, source: string) {
  const nonce = randomUUID();
  const result = await client.call<{ type: string; output: string }>("command.dispatch", { session_id: sessionId, name: "sentinel-gate-status", arg: nonce });
  let proof: Record<string, unknown>;
  try { proof = JSON.parse(result.output); } catch { throw new RuntimeError("Trusted Telegram gate is unavailable", "telegram_gate_unavailable", 503); }
  if (result.type !== "plugin" || proof.nonce !== nonce || proof.version !== 1 || proof.source !== source || proof.profile !== profile || proof.ready !== true) {
    throw new RuntimeError("Telegram runtime gate or memory ownership is not ready", "telegram_gate_unavailable", 503);
  }
}
