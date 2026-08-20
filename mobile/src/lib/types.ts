// Wire shapes returned by the Sentinel API — kept as a hand-written mirror
// of src/types/index.ts and useChatSession.ts's ApiRoom/ApiMessage in the
// web app, not a shared package, since the two apps don't share a build
// today. Field names and the SSE event union below are a contract with the
// server; changing either side means changing both.

export interface ApiRoom {
  id: string;
  name: string;
  agentIds: string[];
  projectId: string | null;
  createdAt: string;
  _count: { messages: number };
}

export type MessageRole = "user" | "agent" | "system";

export interface ApiMessage {
  id: string;
  role: MessageRole;
  agentId: string | null;
  content: string;
  toolCalls: unknown;
  createdAt: string;
}

/** A message as the chat screen renders it — ApiMessage plus the local-only
 * fields an optimistic/streaming turn needs before it has a server id. */
export interface ChatMessage {
  id: string;
  role: MessageRole;
  agentId?: string;
  content: string;
  createdAt: string;
  isStreaming?: boolean;
}

export type ChatStreamEvent =
  | { type: "text"; text: string }
  | { type: "error"; error: string }
  | { type: "knowledge_update"; roomId?: string }
  | { type: "presence"; agentId: string; status: "thinking" | "idle" }
  | { type: "done" };
