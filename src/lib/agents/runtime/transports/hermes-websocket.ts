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
 *   ← server request: {"jsonrpc":"2.0","id":"srq-<hex>","method":<kind>,"params":{"session_id":<sid>,...}}
 *   → its reply:      {"jsonrpc":"2.0","id":"srq-<hex>","result":{...}|"error":{...}}
 *
 * Server requests (Hermes 0.21+: approval, clarify, sudo, secret, ...) are only sent to a connection that
 * said `client.capabilities {server_requests: true}`; see advertiseServerRequests(). Before that Hermes
 * withholds them and treats each as unanswered.
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

export interface HermesServerRequest {
  id: string;
  method: string;
  params: Record<string, unknown>;
}

/** The reply to a server request: a result object, or an error (Hermes treats an error as "no answer"). */
export type HermesServerReply = { result: Record<string, unknown> } | { error: { code: number; message: string } };

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
  private requestHandler: ((request: HermesServerRequest) => Promise<HermesServerReply>) | null = null;
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
    credentials?: { username: string; password: string },
  ): Promise<HermesWebSocketClient> {
    let authQuery: string;
    if (sessionToken) {
      authQuery = `token=${encodeURIComponent(sessionToken)}`;
    } else {
      let cookie: string | undefined;
      if (credentials) {
        const login = await fetcher(`${endpoint}/auth/password-login`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ provider: "basic", ...credentials, next: "/" }), signal: AbortSignal.timeout(timeoutMs), redirect: "manual" });
        if (!login.ok) throw new HermesWsError(`Dashboard login failed (${login.status})`);
        cookie = login.headers.getSetCookie().map(value => value.split(";")[0]).join("; ");
      }
      const ticketRes = await fetcher(`${endpoint}/api/auth/ws-ticket`, {
        method: "POST",
        ...(cookie ? { headers: { Cookie: cookie } } : {}),
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

  /**
   * Answer Hermes's server→client requests on this connection. Only one handler; it must reply to every
   * request it is given (a throw is sent as an error reply). Pair with advertiseServerRequests().
   */
  onRequest(handler: (request: HermesServerRequest) => Promise<HermesServerReply>): () => void {
    this.requestHandler = handler;
    return () => { if (this.requestHandler === handler) this.requestHandler = null; };
  }

  /** Tell Hermes this connection answers server requests. Without it Hermes never sends them here. */
  async advertiseServerRequests(): Promise<void> {
    await this.call("client.capabilities", { server_requests: true });
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
    let frame: { id?: number | string; result?: unknown; error?: { code: number; message: string }; method?: string; params?: HermesEventFrame };
    try {
      frame = JSON.parse(raw);
    } catch {
      return;
    }

    if (frame.method === "event" && frame.params) {
      for (const handler of this.eventHandlers) handler(frame.params);
      return;
    }

    // Hermes mints string ids (`srq-...`) for its own requests, so they never collide with ours.
    if (typeof frame.id === "string" && typeof frame.method === "string") {
      const request: HermesServerRequest = { id: frame.id, method: frame.method, params: (frame.params ?? {}) as unknown as Record<string, unknown> };
      const handler = this.requestHandler;
      if (!handler) return;
      void handler(request)
        .catch((error: unknown): HermesServerReply => ({ error: { code: -32603, message: error instanceof Error ? error.message : String(error) } }))
        .then((reply) => this.reply(request.id, reply));
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

  private reply(id: string, reply: HermesServerReply) {
    if (!this.ws || this.closed) return;
    this.ws.send(JSON.stringify({ jsonrpc: "2.0", id, ...reply }));
  }

  private handleClose() {
    if (this.closed) return;
    this.closed = true;
    for (const { reject } of this.pending.values()) reject(new HermesWsError("connection closed"));
    this.pending.clear();
  }
}
