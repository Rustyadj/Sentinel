// A small Agent2Agent (A2A) client: read an agent's card, send it one message,
// return its answer as text. JSON-RPC binding only.
//
// Two wire dialects are in use and both are spoken here:
//   "1.0"  SendMessage / GetTask, parts as {text}, ROLE_USER, A2A-Version header
//   "0.3"  message/send / tasks/get, parts as {kind:"text"}, role "user"
// The card says which one an agent speaks; see readAgentCard.

import { randomUUID } from "node:crypto";
import { OutsideAgentError, parseOutsideUrl, requestOutsideJson, type OutsideTransport } from "./http";

export type A2aDialect = "1.0" | "0.3";

export interface AgentCardSummary {
  name: string;
  description: string;
  endpointUrl: string;
  dialect: A2aDialect;
}

const CARD_PATH = "/.well-known/agent-card.json";
const CARD_TIMEOUT_MS = 10_000;
const CARD_MAX_BYTES = 256 * 1024;
const REPLY_MAX_BYTES = 1024 * 1024;
const REPLY_DEADLINE_MS = 120_000;
const POLL_INTERVAL_MS = 2_000;
const NAME_MAX = 80;
const DESCRIPTION_MAX = 400;

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown, max: number) => (typeof value === "string" ? value.replace(/\s+/g, " ").trim().slice(0, max) : "");

/** Where the card lives, given what a person pasted: the card itself, or the agent's base address. */
export function agentCardUrl(raw: string): string {
  const url = parseOutsideUrl(raw);
  if (!url.pathname.endsWith(".json")) url.pathname = `${url.pathname.replace(/\/+$/, "")}${CARD_PATH}`;
  return url.toString();
}

/** Picks the JSON-RPC interface out of a card. Pure, so the card shapes can be tested without a server. */
export function readAgentCard(card: unknown): AgentCardSummary {
  if (!isObject(card)) throw new OutsideAgentError("That address did not return an Agent Card.", "bad_response");
  const name = text(card.name, NAME_MAX);
  if (!name) throw new OutsideAgentError("The Agent Card has no name.", "bad_response");
  const description = text(card.description, DESCRIPTION_MAX);
  const isJsonRpc = (value: unknown) => typeof value === "string" && value.toUpperCase() === "JSONRPC";

  const current = Array.isArray(card.supportedInterfaces)
    ? card.supportedInterfaces.find((entry): entry is Json => isObject(entry) && isJsonRpc(entry.protocolBinding) && typeof entry.url === "string")
    : undefined;
  if (current) {
    const version = typeof current.protocolVersion === "string" ? current.protocolVersion : "1.0";
    return { name, description, endpointUrl: parseOutsideUrl(current.url as string).toString(), dialect: version.startsWith("0.") ? "0.3" : "1.0" };
  }

  if (typeof card.url === "string" && (card.preferredTransport === undefined || isJsonRpc(card.preferredTransport))) {
    return { name, description, endpointUrl: parseOutsideUrl(card.url).toString(), dialect: "0.3" };
  }
  const legacy = Array.isArray(card.additionalInterfaces)
    ? card.additionalInterfaces.find((entry): entry is Json => isObject(entry) && isJsonRpc(entry.transport) && typeof entry.url === "string")
    : undefined;
  if (legacy) return { name, description, endpointUrl: parseOutsideUrl(legacy.url as string).toString(), dialect: "0.3" };

  throw new OutsideAgentError("This agent does not offer the JSON-RPC interface, which is the one Sentinel speaks.", "protocol_unsupported", 422);
}

export async function fetchAgentCard(cardUrl: string, transport: OutsideTransport = requestOutsideJson): Promise<AgentCardSummary> {
  return readAgentCard(await transport({ url: cardUrl, method: "GET", timeoutMs: CARD_TIMEOUT_MS, maxBytes: CARD_MAX_BYTES }));
}

const partsText = (parts: unknown) =>
  Array.isArray(parts) ? parts.map((part) => (isObject(part) && typeof part.text === "string" ? part.text : "")).filter(Boolean).join("\n").trim() : "";

export type A2aOutcome =
  | { kind: "reply"; text: string }
  | { kind: "pending"; taskId: string }
  | { kind: "failed"; reason: string };

/** Reads a JSON-RPC response from either dialect into one of three outcomes. Pure. */
export function readA2aResponse(response: unknown): A2aOutcome {
  if (!isObject(response)) throw new OutsideAgentError("The agent's answer was not a JSON-RPC response.", "bad_response");
  if (isObject(response.error)) return { kind: "failed", reason: text(response.error.message, 300) || "The agent returned an error." };
  const result = response.result;
  if (!isObject(result)) throw new OutsideAgentError("The agent's answer had no result.", "bad_response");
  const body = isObject(result.task) ? result.task : isObject(result.message) ? result.message : result;

  // A Message: the agent answered directly.
  if (Array.isArray(body.parts)) {
    const reply = partsText(body.parts);
    if (!reply) throw new OutsideAgentError("The agent answered without any text.", "bad_response");
    return { kind: "reply", text: reply };
  }

  // A Task.
  const status = isObject(body.status) ? body.status : {};
  const state = typeof status.state === "string" ? status.state.toLowerCase().replace(/^task_state_/, "").replace(/_/g, "-") : "";
  const said = isObject(status.message) ? partsText(status.message.parts) : "";
  if (state === "completed") {
    const produced = Array.isArray(body.artifacts) ? body.artifacts.map((artifact) => (isObject(artifact) ? partsText(artifact.parts) : "")).filter(Boolean).join("\n\n") : "";
    const reply = produced || said;
    if (!reply) throw new OutsideAgentError("The agent finished without any text.", "bad_response");
    return { kind: "reply", text: reply };
  }
  // The agent is asking the person something; that question is its reply.
  if (state === "input-required" && said) return { kind: "reply", text: said };
  if (state === "submitted" || state === "working") {
    if (typeof body.id !== "string" || !body.id) throw new OutsideAgentError("The agent started a task without an id.", "bad_response");
    return { kind: "pending", taskId: body.id };
  }
  return { kind: "failed", reason: said.slice(0, 300) || `The agent's task ended as ${state || "unknown"}.` };
}

function rpc(dialect: A2aDialect, method: "send" | "get", params: Json) {
  const names = dialect === "1.0" ? { send: "SendMessage", get: "GetTask" } : { send: "message/send", get: "tasks/get" };
  return { jsonrpc: "2.0", id: randomUUID(), method: names[method], params };
}

function sendParams(dialect: A2aDialect, prompt: string): Json {
  const messageId = randomUUID();
  return dialect === "1.0"
    ? { message: { messageId, role: "ROLE_USER", parts: [{ text: prompt }] } }
    : { message: { kind: "message", messageId, role: "user", parts: [{ kind: "text", text: prompt }] }, configuration: { blocking: true } };
}

export interface SendToAgentInput {
  endpointUrl: string;
  dialect: A2aDialect;
  /** Sentinel's token for this agent; the agent's server is told to expect it. */
  token: string;
  prompt: string;
}

/**
 * Sends one message and waits for the answer. An agent that answers with a
 * task still in progress is polled until it finishes or the deadline passes.
 * Throws OutsideAgentError; never returns a partial or substituted answer.
 */
export async function sendToAgent(
  input: SendToAgentInput,
  options: { transport?: OutsideTransport; deadlineMs?: number; pollIntervalMs?: number } = {},
): Promise<string> {
  const transport = options.transport ?? requestOutsideJson;
  const deadline = Date.now() + (options.deadlineMs ?? REPLY_DEADLINE_MS);
  const headers = { authorization: `Bearer ${input.token}`, ...(input.dialect === "1.0" ? { "a2a-version": "1.0" } : {}) };
  const call = (method: "send" | "get", params: Json) => {
    const remaining = deadline - Date.now();
    if (remaining <= 0) throw new OutsideAgentError("The agent took too long to answer.", "timed_out", 504);
    return transport({ url: input.endpointUrl, method: "POST", headers, body: rpc(input.dialect, method, params), timeoutMs: remaining, maxBytes: REPLY_MAX_BYTES });
  };

  let outcome = readA2aResponse(await call("send", sendParams(input.dialect, input.prompt)));
  while (outcome.kind === "pending") {
    await new Promise((resolve) => setTimeout(resolve, options.pollIntervalMs ?? POLL_INTERVAL_MS));
    outcome = readA2aResponse(await call("get", { id: outcome.taskId }));
  }
  if (outcome.kind === "failed") throw new OutsideAgentError(outcome.reason, "agent_failed");
  return outcome.text;
}
