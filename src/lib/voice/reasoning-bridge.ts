/**
 * Bridges a live voice turn into Sentinel's existing chat runtime.
 *
 * The live layer carries audio; this is where thinking happens, and it
 * happens on exactly the path a typed message takes. `routeRuntimeChat` is
 * called unchanged, so the turn gets the agent's own runtime, memory,
 * permissions, MCP tools, audit trail and chat persistence — one
 * conversation, one memory, one authorization model, whether the user typed
 * or spoke. Nothing voice-specific is reimplemented here; this only adapts a
 * streaming response into the single answer the live layer needs to speak.
 */
import { routeRuntimeChat, RUNTIME_AGENT_MAP } from "@/lib/agents/runtime/chat-routing";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";
import type { AgentRuntimeKind } from "@/lib/agents/runtime/types";
import { writeAuditLog } from "@/lib/workspaces/audit";

export interface VoiceReasoningResult {
  answer: string;
  latencyMs: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** The model that actually ran, as reported by the runtime. */
  executedModel: string | null;
  /** Names of the tools the runtime called — ground truth for System 1 shadow scoring. */
  toolNames: string[];
  /** True when the caller aborted (user interrupted) and the runtime turn was cancelled. */
  cancelled: boolean;
}

interface SseEvent {
  type?: string;
  text?: string;
  sessionId?: string;
  runtime?: string;
  event?: { type?: string; data?: Record<string, unknown> };
}

/** Pulls `data:` frames out of the runtime's SSE stream. */
async function* readSseEvents(response: Response, signal?: AbortSignal): AsyncGenerator<SseEvent> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
  const onAbort = () => void reader.cancel().catch(() => {});
  signal?.addEventListener("abort", onAbort, { once: true });
  if (signal?.aborted) onAbort();
  try {
    yield* readFrames(reader);
  } finally {
    signal?.removeEventListener("abort", onAbort);
  }
}

async function* readFrames(reader: ReadableStreamDefaultReader<Uint8Array>): AsyncGenerator<SseEvent> {
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    // Frames are separated by a blank line; keep the trailing partial.
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      const line = frame.split("\n").find((l) => l.startsWith("data: "));
      if (!line) continue;
      try {
        yield JSON.parse(line.slice(6)) as SseEvent;
      } catch {
        // A frame we cannot parse is not worth aborting a spoken turn over.
      }
    }
  }
}

function readTokenCount(data: Record<string, unknown> | undefined, keys: string[]): number {
  if (!data) return 0;
  const usage = (data.usage ?? data) as Record<string, unknown>;
  for (const key of keys) {
    const value = usage?.[key];
    if (typeof value === "number" && Number.isFinite(value) && value >= 0) return value;
  }
  return 0;
}

/**
 * Tool starts as runtimes actually report them. Hermes emits `tool_started`
 * (phase `tool.start`, then again as `tool.generating`); the older
 * `tool_call` shape is kept for runtimes that use it. Counting only
 * `tool_call` — as this did before — reported zero tools for every Hermes turn.
 */
function toolStartName(type: string | undefined, data: Record<string, unknown> | undefined): string | null | undefined {
  if (type === "tool_call") return toolName(data);
  if (type === "tool_started" && data?.phase !== "tool.generating") return toolName(data);
  return undefined;
}

function toolName(data: Record<string, unknown> | undefined): string | null {
  for (const key of ["name", "tool_name", "tool"]) {
    const value = data?.[key];
    if (typeof value === "string" && value) return value;
  }
  return null;
}

async function cancelRuntimeSession(sessionId: string, runtime: string | undefined, userId: string) {
  if (!runtime) return;
  try {
    const result = await getRuntimeAdapter(runtime as AgentRuntimeKind).cancel(sessionId);
    await writeAuditLog({
      userId,
      action: "agent_runtime.task_cancelled",
      entityType: "AgentSession",
      entityId: sessionId,
      details: { runtime, success: result.success, reason: "voice_interrupt" },
    });
  } catch {
    // Best effort: the user has already moved on, and the runtime's own
    // timeout still bounds an uncancelled turn.
  }
}

export function isVoiceCapableRuntimeAgent(agentId: string): boolean {
  return Boolean(RUNTIME_AGENT_MAP[agentId]);
}

/**
 * Runs one spoken turn through the agent's configured brain.
 *
 * `reasoningModel` is not passed to the runtime: which model an agent thinks
 * with is the agent's own configuration, and letting a voice session name a
 * model would be exactly the automatic swapping this must not allow. It is
 * returned alongside the answer only so telemetry can record what was
 * expected and compare it against what the runtime reports it actually ran.
 */
export async function runVoiceReasoningTurn(input: {
  agentId: string;
  userId: string;
  roomId?: string;
  request: string;
  /** Aborted when the user interrupts; cancels the runtime turn rather than finishing it. */
  signal?: AbortSignal;
  onFirstText?: () => void;
}): Promise<VoiceReasoningResult> {
  const route = RUNTIME_AGENT_MAP[input.agentId];
  if (!route) {
    throw new Error(`Agent ${input.agentId} has no runtime configured for voice reasoning.`);
  }

  const startedAt = Date.now();
  const response = await routeRuntimeChat({
    agentId: input.agentId,
    userId: input.userId,
    roomId: input.roomId,
    userContent: input.request,
    mode: route.mode,
  });

  let answer = "";
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let executedModel: string | null = null;
  let sessionId: string | undefined;
  let runtimeKind: string | undefined;
  const toolNames: string[] = [];

  for await (const event of readSseEvents(response, input.signal)) {
    if (event.type === "source") {
      sessionId = event.sessionId;
      runtimeKind = event.runtime;
      continue;
    }
    if (event.type === "text" && typeof event.text === "string") {
      if (!answer) input.onFirstText?.();
      answer += event.text;
      continue;
    }
    const runtimeEvent = event.event;
    if (!runtimeEvent) continue;
    // Tool executions are counted from the runtime's own events, so voice
    // reports the same tool activity the typed path would.
    const started = toolStartName(runtimeEvent.type, runtimeEvent.data);
    if (started !== undefined) {
      toolCalls += 1;
      if (started) toolNames.push(started);
    }
    const data = runtimeEvent.data;
    if (data) {
      inputTokens = readTokenCount(data, ["inputTokens", "input_tokens", "promptTokens"]) || inputTokens;
      outputTokens = readTokenCount(data, ["outputTokens", "output_tokens", "completionTokens"]) || outputTokens;
      const model = data.actualModel ?? data.model;
      if (typeof model === "string" && model) executedModel = model;
    }
  }

  const cancelled = Boolean(input.signal?.aborted);
  if (cancelled && sessionId) void cancelRuntimeSession(sessionId, runtimeKind, input.userId);

  return {
    answer: answer.trim(),
    latencyMs: Date.now() - startedAt,
    toolCalls,
    inputTokens,
    outputTokens,
    executedModel,
    toolNames,
    cancelled,
  };
}
