import crypto, { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import WebSocket, { type RawData } from "ws";

const PROTOCOL_VERSION = 4;
const CLIENT_ID = "gateway-client";
const CLIENT_MODE = "backend";
const CLIENT_ROLE = "operator";
const CLIENT_SCOPES = ["operator.read", "operator.write"] as const;
const CLIENT_CAPABILITIES = ["tool-events"] as const;

export interface OpenClawDeviceIdentity {
  deviceId: string;
  publicKey: string;
  privateKeyPem: string;
  deviceToken?: string;
}

export interface OpenClawGatewayFrame {
  type: "event" | "res";
  id?: string;
  ok?: boolean;
  event?: string;
  payload?: Record<string, unknown>;
  error?: { code?: string; message?: string; details?: unknown };
}

interface PendingRequest {
  resolve: (value: Record<string, unknown>) => void;
  reject: (error: Error) => void;
  expectFinal: boolean;
  onAccepted?: (payload: Record<string, unknown>) => void;
  timer: NodeJS.Timeout;
}

export type OpenClawGatewayEventListener = (frame: OpenClawGatewayFrame) => void;
export type OpenClawWebSocketConstructor = typeof WebSocket;

export interface OpenClawGatewayClientOptions {
  url: string;
  identity: OpenClawDeviceIdentity;
  sharedToken?: string;
  WebSocketConstructor?: OpenClawWebSocketConstructor;
  handshakeTimeoutMs?: number;
  requestTimeoutMs?: number;
}

export class OpenClawGatewayRequestError extends Error {
  constructor(
    message: string,
    readonly code = "UNAVAILABLE",
    readonly details?: unknown,
  ) {
    super(message);
  }
}

export class OpenClawGatewayClient {
  private socket: WebSocket | null = null;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly listeners = new Set<OpenClawGatewayEventListener>();
  private connectPromise: Promise<Record<string, unknown>> | null = null;

  constructor(private readonly options: OpenClawGatewayClientOptions) {}

  connect(): Promise<Record<string, unknown>> {
    if (this.connectPromise) return this.connectPromise;
    this.connectPromise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const WebSocketConstructor = this.options.WebSocketConstructor ?? WebSocket;
      const socket = new WebSocketConstructor(this.options.url);
      this.socket = socket;
      const timer = setTimeout(() => {
        reject(new OpenClawGatewayRequestError("OpenClaw gateway handshake timed out", "TIMEOUT"));
        socket.terminate();
      }, this.options.handshakeTimeoutMs ?? 10_000);

      const fail = (error: Error) => {
        clearTimeout(timer);
        reject(error);
      };
      socket.once("error", (error) => fail(error instanceof Error ? error : new Error(String(error))));
      socket.once("close", (code, reason) => {
        if (!this.socket) return;
        const error = new OpenClawGatewayRequestError(
          `OpenClaw gateway closed (${code})${reason.length ? `: ${reason.toString()}` : ""}`,
          "CONNECTION_CLOSED",
        );
        this.rejectPending(error);
        fail(error);
      });
      socket.on("message", (raw) => {
        void this.handleMessage(raw, resolve, reject, timer);
      });
    });
    return this.connectPromise;
  }

  onEvent(listener: OpenClawGatewayEventListener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  request(
    method: string,
    params: Record<string, unknown>,
    options: { expectFinal?: boolean; timeoutMs?: number; onAccepted?: (payload: Record<string, unknown>) => void } = {},
  ) {
    const socket = this.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) {
      return Promise.reject(new OpenClawGatewayRequestError("OpenClaw gateway is not connected", "NOT_CONNECTED"));
    }
    const id = randomUUID();
    const timeoutMs = options.timeoutMs ?? this.options.requestTimeoutMs ?? 10 * 60_000;
    const promise = new Promise<Record<string, unknown>>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new OpenClawGatewayRequestError(`OpenClaw request timed out: ${method}`, "TIMEOUT"));
      }, timeoutMs);
      this.pending.set(id, {
        resolve,
        reject,
        expectFinal: options.expectFinal === true,
        onAccepted: options.onAccepted,
        timer,
      });
    });
    socket.send(JSON.stringify({ type: "req", id, method, params }));
    return promise;
  }

  close() {
    const socket = this.socket;
    this.socket = null;
    this.connectPromise = null;
    if (socket && socket.readyState < WebSocket.CLOSING) socket.close();
    this.rejectPending(new OpenClawGatewayRequestError("OpenClaw gateway client closed", "CLIENT_CLOSED"));
  }

  private async handleMessage(
    raw: RawData,
    resolveConnect: (hello: Record<string, unknown>) => void,
    rejectConnect: (error: Error) => void,
    connectTimer: NodeJS.Timeout,
  ) {
    let frame: OpenClawGatewayFrame;
    try {
      frame = JSON.parse(raw.toString()) as OpenClawGatewayFrame;
    } catch {
      return;
    }
    if (frame.type === "event") {
      if (frame.event === "connect.challenge") {
        const nonce = typeof frame.payload?.nonce === "string" ? frame.payload.nonce : "";
        if (!nonce) {
          rejectConnect(new OpenClawGatewayRequestError("OpenClaw connect challenge omitted its nonce", "INVALID_CHALLENGE"));
          return;
        }
        try {
          const hello = await this.sendConnect(nonce);
          clearTimeout(connectTimer);
          resolveConnect(hello);
        } catch (error) {
          clearTimeout(connectTimer);
          rejectConnect(error instanceof Error ? error : new Error(String(error)));
        }
        return;
      }
      for (const listener of this.listeners) listener(frame);
      return;
    }
    if (frame.type !== "res" || !frame.id) return;
    const pending = this.pending.get(frame.id);
    if (!pending) return;
    const payload = frame.payload ?? {};
    if (pending.expectFinal && payload.status === "accepted") {
      pending.onAccepted?.(payload);
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(frame.id);
    if (frame.ok) pending.resolve(payload);
    else pending.reject(new OpenClawGatewayRequestError(
      frame.error?.message ?? "OpenClaw gateway request failed",
      frame.error?.code ?? "UNAVAILABLE",
      frame.error?.details,
    ));
  }

  private sendConnect(nonce: string) {
    const { identity } = this.options;
    const token = identity.deviceToken ?? this.options.sharedToken;
    if (!token) throw new OpenClawGatewayRequestError("OpenClaw device token is not configured", "AUTH_TOKEN_MISSING");
    const signedAt = Date.now();
    const signaturePayload = [
      "v3",
      identity.deviceId,
      CLIENT_ID,
      CLIENT_MODE,
      CLIENT_ROLE,
      CLIENT_SCOPES.join(","),
      String(signedAt),
      token,
      nonce,
      "linux",
      "",
    ].join("|");
    const signature = crypto.sign(null, Buffer.from(signaturePayload, "utf8"), identity.privateKeyPem).toString("base64url");
    return this.request("connect", {
      minProtocol: PROTOCOL_VERSION,
      maxProtocol: PROTOCOL_VERSION,
      client: {
        id: CLIENT_ID,
        displayName: "Sentinel OS",
        version: process.env.SENTINEL_RELEASE_SHA ?? "unknown",
        platform: "linux",
        mode: CLIENT_MODE,
        instanceId: randomUUID(),
      },
      caps: [...CLIENT_CAPABILITIES],
      auth: { token },
      role: CLIENT_ROLE,
      scopes: [...CLIENT_SCOPES],
      device: {
        id: identity.deviceId,
        publicKey: identity.publicKey,
        signature,
        signedAt,
        nonce,
      },
    }, { timeoutMs: this.options.handshakeTimeoutMs ?? 10_000 });
  }

  private rejectPending(error: Error) {
    for (const pending of this.pending.values()) {
      clearTimeout(pending.timer);
      pending.reject(error);
    }
    this.pending.clear();
  }
}

export async function loadOpenClawDeviceIdentity(filePath: string): Promise<OpenClawDeviceIdentity> {
  const parsed = JSON.parse(await readFile(filePath, "utf8")) as Partial<OpenClawDeviceIdentity>;
  if (!parsed.deviceId || !parsed.publicKey || !parsed.privateKeyPem) {
    throw new OpenClawGatewayRequestError("OpenClaw device identity file is incomplete", "IDENTITY_INVALID");
  }
  const privateKey = crypto.createPrivateKey(parsed.privateKeyPem);
  const publicDer = crypto.createPublicKey(privateKey).export({ type: "spki", format: "der" });
  const publicKey = publicDer.subarray(publicDer.length - 32).toString("base64url");
  const deviceId = crypto.createHash("sha256").update(publicDer.subarray(publicDer.length - 32)).digest("hex");
  if (publicKey !== parsed.publicKey || deviceId !== parsed.deviceId) {
    throw new OpenClawGatewayRequestError("OpenClaw device identity key pair does not match", "IDENTITY_INVALID");
  }
  return {
    deviceId,
    publicKey,
    privateKeyPem: parsed.privateKeyPem,
    ...(parsed.deviceToken ? { deviceToken: parsed.deviceToken } : {}),
  };
}

export function openClawGatewayUrl(runtimeEndpoint?: string) {
  const configured = process.env.OPENCLAW_GATEWAY_URL?.trim();
  if (configured) return configured;
  if (!runtimeEndpoint) return "ws://127.0.0.1:18789";
  const url = new URL(runtimeEndpoint);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.toString();
}
