import { createHash } from "node:crypto";
import WebSocket from "ws";

export const LIVE_SESSIONS_URL = "wss://api.openai.com/v1/live/sessions";
const START_TIMEOUT_MS = 10_000;
const CLOSE_TIMEOUT_MS = 5_000;

export interface LiveEvent {
  type?: string;
  delta?: string;
  start_ms?: number;
  end_ms?: number;
  offset_ms?: number;
  event_id?: string;
  client_event_id?: string;
  session?: { id?: string };
  usage?: { seconds?: number };
  reason?: string;
  error?: { message?: string; code?: string | null };
  delegation?: { id?: string; target?: string };
}

export interface LiveSessionConfig {
  model: string;
  voice: string;
  instructions: string;
  /** Prior text turns, used to resume after a dropped connection. */
  history?: { role: "user" | "assistant"; text: string }[];
}

export interface LiveSessionOptions {
  apiKey: string;
  userId: string;
  url?: string;
  /** Injected in tests. */
  createSocket?: (url: string, headers: Record<string, string>) => WebSocket;
}

/**
 * One GPT-Live server-side session over the documented WebSocket transport,
 * configured for the phone leg's native G.711 μ-law so audio passes through
 * with no transcoding. Delegation is "client": every substantive turn comes
 * back to Sentinel, which runs it on the agent's own brain.
 */
export class GptLiveSession {
  private socket: WebSocket | null = null;
  private closedPromise: Promise<void> | null = null;
  private resolveClosed: (() => void) | null = null;
  private seq = 0;
  sessionId: string | null = null;
  closed = false;
  /** Latest cumulative voice seconds; usage updates are snapshots, not increments. */
  usageSeconds = 0;

  constructor(
    private readonly options: LiveSessionOptions,
    private readonly handlers: { onEvent: (event: LiveEvent) => void; onClose: (cleanly: boolean) => void },
  ) {}

  nextEventId(): string {
    return `tel-${++this.seq}`;
  }

  connect(config: LiveSessionConfig): Promise<string> {
    const headers = {
      Authorization: `Bearer ${this.options.apiKey}`,
      "OpenAI-Safety-Identifier": createHash("sha256").update(this.options.userId).digest("hex"),
    };
    const url = this.options.url ?? LIVE_SESSIONS_URL;
    const socket = this.options.createSocket ? this.options.createSocket(url, headers) : new WebSocket(url, { headers });
    this.socket = socket;
    this.closedPromise = new Promise((resolve) => { this.resolveClosed = resolve; });

    return new Promise<string>((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error("GPT-Live did not start the session in time"));
        socket.terminate();
      }, START_TIMEOUT_MS);

      socket.on("open", () => {
        socket.send(JSON.stringify({
          type: "session.start",
          event_id: this.nextEventId(),
          session: {
            model: config.model,
            instructions: config.instructions,
            audio: { format: { type: "audio/pcmu", rate: 8000 }, output: { voice: config.voice } },
            delegation: { type: "client" },
            ...(config.history?.length
              ? {
                  input: config.history.slice(-100).map((turn) => ({
                    type: "message",
                    role: turn.role,
                    content: [{ type: turn.role === "user" ? "input_text" : "output_text", text: turn.text }],
                  })),
                }
              : {}),
          },
        }));
      });

      socket.on("message", (raw) => {
        let event: LiveEvent;
        try {
          event = JSON.parse(String(raw)) as LiveEvent;
        } catch {
          return;
        }
        if (event.type === "session.started") {
          clearTimeout(timer);
          this.sessionId = event.session?.id ?? null;
          resolve(this.sessionId ?? "");
        } else if (event.type === "session.usage.updated") {
          this.usageSeconds = event.usage?.seconds ?? this.usageSeconds;
        } else if (event.type === "session.closed") {
          this.usageSeconds = event.usage?.seconds ?? this.usageSeconds;
          this.closed = true;
          this.resolveClosed?.();
        } else if (event.type === "error" && !this.sessionId) {
          clearTimeout(timer);
          reject(new Error(event.error?.message ?? "GPT-Live rejected the session"));
        }
        this.handlers.onEvent(event);
      });

      socket.on("error", (error) => {
        clearTimeout(timer);
        reject(error);
      });
      socket.on("close", () => {
        clearTimeout(timer);
        const cleanly = this.closed;
        this.closed = true;
        this.resolveClosed?.();
        this.handlers.onClose(cleanly);
      });
    });
  }

  get open(): boolean {
    return this.socket?.readyState === WebSocket.OPEN && !this.closed;
  }

  send(event: object): void {
    if (!this.open) throw new Error("The live session is not active");
    this.socket!.send(JSON.stringify(event));
  }

  /** μ-law bytes straight from the phone leg, base64. */
  appendAudio(base64: string): void {
    if (this.open) this.socket!.send(JSON.stringify({ type: "session.input_audio.append", audio: base64 }));
  }

  /** Graceful close: wait for session.closed so final usage is confirmed, but never hang the hang-up. */
  async close(): Promise<void> {
    if (!this.socket) return;
    if (this.open) {
      try { this.socket.send(JSON.stringify({ type: "session.close", event_id: this.nextEventId() })); } catch { /* socket already gone */ }
      await Promise.race([this.closedPromise, new Promise((r) => setTimeout(r, CLOSE_TIMEOUT_MS))]);
    }
    if (this.socket.readyState !== WebSocket.CLOSED) this.socket.terminate();
  }
}
