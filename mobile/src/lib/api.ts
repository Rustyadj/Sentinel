// All network calls into the Sentinel API. Two things make this different
// from a typical RN client:
//
// 1. There's no cookie jar carrying a session the way a browser tab does —
//    every call is explicitly handed { baseUrl, token } rather than reading
//    from some ambient global, and auth-context.tsx is the only thing that
//    owns that pair.
// 2. Streaming a chat reply needs a real ReadableStream body, which React
//    Native's built-in fetch doesn't give you. `expo/fetch` does — it's a
//    native-networking-backed implementation Expo ships specifically for
//    this (see FetchResponse.ts's body getter) — so it's used here instead
//    of global fetch for the one call that streams.
import { fetch as expoFetch } from "expo/fetch";
import type { ApiMessage, ApiRoom, ChatStreamEvent } from "./types";

export interface Session {
  baseUrl: string;
  token: string;
}

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
}

function authHeaders(token: string): Record<string, string> {
  return { Authorization: `Bearer ${token}` };
}

async function errorMessage(res: Response): Promise<string> {
  try {
    const data = (await res.json()) as { error?: string };
    return data.error ?? `Request failed (${res.status})`;
  } catch {
    return `Request failed (${res.status})`;
  }
}

/** Strips a trailing slash so `${baseUrl}/api/...` never doubles one up. */
export function normalizeBaseUrl(input: string): string {
  return input.trim().replace(/\/+$/, "");
}

export async function login(
  baseUrl: string,
  email: string,
  password: string,
): Promise<{ token: string; user: { id: string; email: string; name: string | null } }> {
  const res = await fetch(`${normalizeBaseUrl(baseUrl)}/api/auth/mobile/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json();
}

export async function getRooms(session: Session): Promise<ApiRoom[]> {
  const res = await fetch(`${session.baseUrl}/api/rooms`, { headers: authHeaders(session.token) });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json();
}

export async function createRoom(session: Session, name: string, agentIds: string[]): Promise<ApiRoom> {
  const res = await fetch(`${session.baseUrl}/api/rooms`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(session.token) },
    body: JSON.stringify({ name, agentIds }),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json();
}

export async function getMessages(session: Session, roomId: string): Promise<ApiMessage[]> {
  const res = await fetch(`${session.baseUrl}/api/rooms/${roomId}/messages`, {
    headers: authHeaders(session.token),
  });
  if (!res.ok) throw new ApiError(await errorMessage(res), res.status);
  return res.json();
}

export interface SendChatMessageArgs {
  session: Session;
  roomId: string;
  agentId: string;
  /** Prior turns plus this one, oldest first — same shape /api/chat expects. */
  history: { role: "user" | "assistant"; content: string }[];
  userContent: string;
  onToken: (text: string) => void;
  onPresence?: (agentId: string, status: "thinking" | "idle") => void;
  onKnowledgeUpdate?: () => void;
  /** AbortSignal so leaving the chat screen mid-stream cancels the request
   * instead of leaving it running against a component that's gone. */
  signal?: AbortSignal;
}

/** POSTs a turn to /api/chat and reads the streamed reply, calling onToken
 * as text arrives. Returns the full assembled reply, or throws on a
 * transport failure or a `{type: "error"}` frame from the server. */
export async function sendChatMessage(args: SendChatMessageArgs): Promise<string> {
  const { session, roomId, agentId, history, userContent, onToken, onPresence, onKnowledgeUpdate, signal } = args;

  const response = await expoFetch(`${session.baseUrl}/api/chat`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders(session.token) },
    body: JSON.stringify({ messages: history, agentId, roomId, userContent }),
    signal,
  });

  if (!response.ok || !response.body) {
    throw new ApiError(await errorMessage(response as unknown as Response), response.status);
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  let full = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice("data: ".length).trim();
        if (raw === "" || raw === "[DONE]") continue;

        let event: ChatStreamEvent;
        try {
          event = JSON.parse(raw) as ChatStreamEvent;
        } catch {
          continue; // malformed frame — skip, same as the web client
        }

        if (event.type === "text") {
          full += event.text;
          onToken(event.text);
        } else if (event.type === "error") {
          throw new ApiError(event.error, 502);
        } else if (event.type === "presence") {
          onPresence?.(event.agentId, event.status);
        } else if (event.type === "knowledge_update") {
          onKnowledgeUpdate?.();
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return full;
}
