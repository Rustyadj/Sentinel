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

export interface VoiceReasoningResult {
  answer: string;
  latencyMs: number;
  toolCalls: number;
  inputTokens: number;
  outputTokens: number;
  /** The model that actually ran, as reported by the runtime. */
  executedModel: string | null;
}

interface SseEvent {
  type?: string;
  text?: string;
  event?: { type?: string; data?: Record<string, unknown> };
}

/** Pulls `data:` frames out of the runtime's SSE stream. */
async function* readSseEvents(response: Response): AsyncGenerator<SseEvent> {
  const body = response.body;
  if (!body) return;
  const reader = body.getReader();
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

  for await (const event of readSseEvents(response)) {
    if (event.type === "text" && typeof event.text === "string") {
      answer += event.text;
      continue;
    }
    const runtimeEvent = event.event;
    if (!runtimeEvent) continue;
    // Tool executions are counted from the runtime's own events, so voice
    // reports the same tool activity the typed path would.
    if (runtimeEvent.type === "tool_call" || runtimeEvent.type === "tool_result") {
      if (runtimeEvent.type === "tool_call") toolCalls += 1;
    }
    const data = runtimeEvent.data;
    if (data) {
      inputTokens = readTokenCount(data, ["inputTokens", "input_tokens", "promptTokens"]) || inputTokens;
      outputTokens = readTokenCount(data, ["outputTokens", "output_tokens", "completionTokens"]) || outputTokens;
      const model = data.actualModel ?? data.model;
      if (typeof model === "string" && model) executedModel = model;
    }
  }

  return {
    answer: answer.trim(),
    latencyMs: Date.now() - startedAt,
    toolCalls,
    inputTokens,
    outputTokens,
    executedModel,
  };
}
