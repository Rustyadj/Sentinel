import WebSocket from "ws";

/**
 * Newline-delimited JSON-RPC 2.0 client for Hermes's `tui_gateway` WebSocket
 * (`/api/ws`). Verified against the live Hermes source (`tui_gateway/ws.py`,
 * `tui_gateway/server.py`) on srv1427612.hstgr.cloud — see
 * docs/reviews/HERMES_OPENCLAW_CHAT_TRANSPORT.md. Not a guessed protocol.
 *
 * Wire shape:
 *   → request:  {"jsonrpc":"2.0","method":<rpc>,"params":{...},"id":<n>}
 *   ← response: {"jsonrpc":"2.0","result":{...}|"error":{...},"id":<n>}
 *   ← event:    {"jsonrpc":"2.0","method":"event","params":{"type":<t>,"session_id":<sid>,"payload":{...}}}
 *
 * The server emits a `gateway.ready` event immediately after accept. Calling
 * `prompt.submit` acks `{"status":"streaming"}` and the real reply streams as
 * a sequence of `event` frames on the same socket — callers subscribe via
 * `onEvent` before calling `call("prompt.submit", ...)`.
 */

export interface HermesEventFrame {
  type: string;
  session_id: string;
  payload?: Record<string, unknown>;
}

interface PendingCall {
  resolve: (result: unknown) => void;
  reject: (error: Error) => void;
}

export class HermesWsError extends Error {
  constructor(message: string, readonly code?: number) {
    super(message);
    this.name = "HermesWsError";
  }
}

const DEFAULT_CONNECT_TIMEOUT_MS = 10_000;

export class HermesWebSocketClient {
  private ws: WebSocket | null = null;
  private nextId = 1;
  private readonly pending = new Map<number, PendingCall>();
  private readonly eventHandlers = new Set<(event: HermesEventFrame) => void>();
  private closed = false;

  private constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => this.handleMessage(raw.toString()));
    ws.on("close", () => this.handleClose());
    ws.on("error", () => this.handleClose());
  }

  /**
   * Mint a single-use WS ticket via `POST /api/auth/ws-ticket`, then open
   * `/api/ws?ticket=...` and wait for the `gateway.ready` event. `endpoint`
   * is the HTTP base (e.g. `http://127.0.0.1:4862`); this derives the `ws://`
   * URL and ticket in one step so callers never see the auth mechanics.
   */
  static async connect(
    endpoint: string,
    fetcher: typeof fetch = fetch,
    timeoutMs = DEFAULT_CONNECT_TIMEOUT_MS,
    sessionToken?: string,
  ): Promise<HermesWebSocketClient> {
    let authQuery: string;
    if (sessionToken) {
      authQuery = `token=${encodeURIComponent(sessionToken)}`;
    } else {
      const ticketRes = await fetcher(`${endpoint}/api/auth/ws-ticket`, {
        method: "POST",
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!ticketRes.ok) throw new HermesWsError(`ws-ticket request failed (${ticketRes.status})`);
      const ticketBody = (await ticketRes.json()) as { ticket?: string };
      if (!ticketBody.ticket) throw new HermesWsError("ws-ticket response missing ticket");
      authQuery = `ticket=${encodeURIComponent(ticketBody.ticket)}`;
    }

    const wsUrl = `${endpoint.replace(/^http/, "ws")}/api/ws?${authQuery}`;
    const ws = new WebSocket(wsUrl);

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new HermesWsError("timed out waiting for gateway.ready"));
      }, timeoutMs);

      const onReady = (raw: WebSocket.RawData) => {
        try {
          const frame = JSON.parse(raw.toString()) as { method?: string; params?: { type?: string } };
          if (frame.method === "event" && frame.params?.type === "gateway.ready") {
            clearTimeout(timer);
            ws.off("message", onReady);
            ws.off("error", onError);
            resolve(new HermesWebSocketClient(ws));
          }
        } catch {
          // Ignore malformed frames while waiting for readiness.
        }
      };
      const onError = (err: Error) => {
        clearTimeout(timer);
        reject(new HermesWsError(`websocket connect failed: ${err.message}`));
      };

      ws.on("message", onReady);
      ws.once("error", onError);
    });
  }

  onEvent(handler: (event: HermesEventFrame) => void): () => void {
    this.eventHandlers.add(handler);
    return () => this.eventHandlers.delete(handler);
  }

  async call<T = unknown>(method: string, params: Record<string, unknown>, timeoutMs = 30_000): Promise<T> {
    if (!this.ws || this.closed) throw new HermesWsError("connection closed");
    const id = this.nextId++;
    const line = JSON.stringify({ jsonrpc: "2.0", method, params, id });

    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new HermesWsError(`RPC "${method}" timed out`));
      }, timeoutMs);

      this.pending.set(id, {
        resolve: (value) => { clearTimeout(timer); resolve(value as T); },
        reject: (err) => { clearTimeout(timer); reject(err); },
      });

      this.ws!.send(line, (err) => {
        if (err) {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(new HermesWsError(`send failed: ${err.message}`));
        }
      });
    });
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.ws?.close();
    this.ws = null;
    for (const { reject } of this.pending.values()) reject(new HermesWsError("connection closed"));
    this.pending.clear();
  }

  private handleMessage(raw: string) {
    let frame: { id?: number; result?: unknown; error?: { code: number; message: string }; method?: string; params?: HermesEventFrame };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (frame.method === "event" && frame.params) {
      for (const handler of this.eventHandlers) handler(frame.params);
      return;
    }

    if (typeof frame.id === "number") {
      const pending = this.pending.get(frame.id);
      if (!pending) return;
      this.pending.delete(frame.id);
      if (frame.error) pending.reject(new HermesWsError(frame.error.message, frame.error.code));
      else pending.resolve(frame.result);
    }
  }

  private handleClose() {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(new HermesWsError("connection closed"));
    this.pending.clear();
  }
}
