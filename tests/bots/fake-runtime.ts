// A scripted stand-in for the Hermes runtime adapter. Everything else in the
// bot path — the executor, its Redis lease, Prisma, the event log, the memory
// pipeline — is real; only the process on the other end of the WebSocket is faked.

export const HOST = {
  id: "runtime-bot-test-host", agentId: "hermes-bot-host", kind: "hermes", transport: "http", endpoint: "http://127.0.0.1:1",
  enabled: true, executionVerified: true, capabilities: {}, sentinelControl: "partial", args: [] as string[],
};

export interface ScriptedEvent { type: string; data: Record<string, unknown> }

export const script = {
  events: [] as ScriptedEvent[],
  startErrors: [] as Error[],
  startCalls: [] as Array<Record<string, unknown>>,
  prompts: [] as string[],
  cancelled: 0,
  ready: true,
  verified: true,
};

export function resetScript() {
  script.events = []; script.startErrors = []; script.startCalls = []; script.prompts = []; script.cancelled = 0; script.ready = true; script.verified = true;
}

let sessionCounter = 0;
export const adapter = {
  kind: "hermes",
  readiness: async () => ({ ready: script.ready, reason: script.ready ? undefined : "not_ready" }),
  health: async () => ({ ready: script.ready, reachable: script.ready, authenticated: script.ready }),
  startSession: async (input: Record<string, unknown>) => {
    script.startCalls.push(input);
    const error = script.startErrors.shift();
    if (error) throw error;
    sessionCounter += 1;
    return { id: `fake-session-${sessionCounter}` };
  },
  send: async function* (input: { sessionId: string; prompt: string }) {
    script.prompts.push(input.prompt);
    let sequence = 0;
    for (const event of script.events) {
      sequence += 1;
      yield { type: event.type, sessionId: input.sessionId, sequence, timestamp: new Date().toISOString(), data: event.data };
    }
  },
  cancel: async () => { script.cancelled += 1; return { success: true }; },
};

const view = () => ({ ...HOST, executionVerified: script.verified });

export const serviceMock = {
  listRuntimeViews: async () => [view()],
  getRuntimeView: async (id: string) => (id === HOST.agentId ? view() : null),
  getRuntimeAdapter: () => adapter,
  getAdapterForRuntime: async () => ({ runtime: view(), adapter }),
};

/** Events for one ordinary successful turn. */
export const turn = (text: string, usage: Record<string, unknown> = { input: 1200, output: 80, total: 1280, model: "test-model-1" }): ScriptedEvent[] => [
  { type: "status", data: { kind: "session_info", model: "test-model-1", provider: "test-provider" } },
  { type: "assistant_delta", data: { text } },
  { type: "completed", data: { text, usage } },
];

export const toolCall = (name: string): ScriptedEvent[] => [
  { type: "tool_started", data: { name, phase: "tool.start", tool_id: `call_${name}` } },
  { type: "tool_completed", data: { name, args: { path: "/x" }, result: { ok: true } } },
];
