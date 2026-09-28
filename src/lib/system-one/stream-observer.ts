/**
 * Watches a runtime chat SSE response on its way to the client, without
 * altering a byte of it, so System 1 can record what System 2 actually did
 * (first token time, tools called, model, tokens) once the turn ends.
 */
export interface ObservedRuntimeTurn {
  toolNames: string[];
  model: string | null;
  inputTokens: number;
  outputTokens: number;
  aborted: boolean;
}

const TOOL_NAME_KEYS = ["name", "tool_name", "tool"];

function readCount(data: Record<string, unknown>, keys: string[]): number {
  const usage = (data.usage ?? data) as Record<string, unknown>;
  for (const key of keys) {
    const v = usage?.[key];
    if (typeof v === "number" && Number.isFinite(v) && v >= 0) return v;
  }
  return 0;
}

export function observeRuntimeStream(
  response: Response,
  hooks: { onFirstText?: () => void; onComplete: (turn: ObservedRuntimeTurn) => Promise<void> | void },
): Response {
  if (!response.body) return response;
  const decoder = new TextDecoder();
  let buffer = "";
  let sawText = false;
  let finished = false;
  const turn: ObservedRuntimeTurn = { toolNames: [], model: null, inputTokens: 0, outputTokens: 0, aborted: false };

  const inspect = (frame: string) => {
    const line = frame.split("\n").find((l) => l.startsWith("data: "));
    if (!line || line === "data: [DONE]") return;
    let event: { type?: string; text?: string; event?: { type?: string; data?: Record<string, unknown> } };
    try {
      event = JSON.parse(line.slice(6));
    } catch {
      return;
    }
    if (event.type === "text" && !sawText) {
      sawText = true;
      hooks.onFirstText?.();
    }
    const runtime = event.event;
    if (!runtime?.data) return;
    const data = runtime.data;
    if ((runtime.type === "tool_started" && data.phase !== "tool.generating") || runtime.type === "tool_call") {
      const name = TOOL_NAME_KEYS.map((k) => data[k]).find((v): v is string => typeof v === "string" && v.length > 0);
      if (name) turn.toolNames.push(name);
    }
    const model = data.actualModel ?? data.model;
    if (typeof model === "string" && model) turn.model = model;
    turn.inputTokens = readCount(data, ["inputTokens", "input_tokens", "promptTokens"]) || turn.inputTokens;
    turn.outputTokens = readCount(data, ["outputTokens", "output_tokens", "completionTokens"]) || turn.outputTokens;
  };

  const complete = () => {
    if (finished) return;
    finished = true;
    Promise.resolve(hooks.onComplete(turn)).catch(() => undefined);
  };

  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          controller.close();
          complete();
          return;
        }
        controller.enqueue(value);
        buffer += decoder.decode(value, { stream: true });
        const frames = buffer.split("\n\n");
        buffer = frames.pop() ?? "";
        for (const frame of frames) inspect(frame);
      } catch (error) {
        controller.error(error);
        turn.aborted = true;
        complete();
      }
    },
    async cancel(reason) {
      turn.aborted = true;
      await reader.cancel(reason).catch(() => undefined);
      complete();
    },
  });

  return new Response(body, { status: response.status, headers: response.headers });
}
