"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Plus,
  Bot,
  Users,
  ChevronDown,
  Wrench,
  ChevronRight,
  AtSign,
  Cpu,
  Loader2,
  AlertTriangle,
} from "lucide-react";
import { useChatStore } from "@/store/useChatStore";
import { useAgentStore } from "@/store/useAgentStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import { useKeyStore } from "@/store/useKeyStore";
import type { Message, Agent, ChatRoom } from "@/types";

// Parse @AgentName from user input — returns matched agent or null
function parseMention(content: string, agents: Agent[]): Agent | null {
  const match = content.match(/@([\w\s]+)/);
  if (!match) return null;
  const name = match[1].trim().toLowerCase();
  return agents.find((a) => a.name.toLowerCase().includes(name)) ?? null;
}

// Read an SSE stream, calling onToken for each text chunk
async function readSSEStream(
  response: Response,
  onToken: (text: string) => void
): Promise<{ error?: string }> {
  if (!response.body) return { error: "No response body" };

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        if (!line.startsWith("data: ")) continue;
        const raw = line.slice(6).trim();
        if (raw === "[DONE]" || raw === "") continue;

        try {
          const parsed = JSON.parse(raw) as
            | { type: "text"; text: string }
            | { type: "error"; error: string }
            | { type: "done" };

          if (parsed.type === "text") onToken(parsed.text);
          if (parsed.type === "error") return { error: parsed.error };
        } catch {
          // skip malformed lines
        }
      }
    }
  } finally {
    reader.releaseLock();
  }

  return {};
}

// Shape returned by GET /api/rooms
interface ApiRoom {
  id: string;
  name: string;
  agentIds: string[];
  projectId: string | null;
  createdAt: string;
  _count: { messages: number };
}

// Shape returned by GET /api/rooms/[roomId]/messages
interface ApiMessage {
  id: string;
  role: string;
  agentId: string | null;
  content: string;
  toolCalls: unknown;
  reasoning: string | null;
  createdAt: string;
}

function apiRoomToChatRoom(r: ApiRoom): ChatRoom {
  return {
    id: r.id,
    name: r.name,
    agents: r.agentIds,
    messages: [],
    createdAt: new Date(r.createdAt),
    ...(r.projectId ? { projectId: r.projectId } : {}),
  };
}

export default function ChatPage() {
  const {
    rooms,
    activeRoomId,
    setActiveRoom,
    addMessage,
    updateMessage,
    createRoom,
    setRooms,
    setRoomMessages,
    hydrated,
    setHydrated,
  } = useChatStore();
  const { agents, updateAgentStatus } = useAgentStore();
  const { anthropicKey, openaiKey, openrouterKey } = useKeyStore();
  const [input, setInput] = useState("");
  const [isThinking, setIsThinking] = useState(false);
  const [streamingMsgId, setStreamingMsgId] = useState<string | null>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<string>("");
  const loadedRoomsRef = useRef<Set<string>>(new Set());

  const activeRoom = rooms.find((r) => r.id === activeRoomId);
  const roomAgents = agents.filter((a) => activeRoom?.agents.includes(a.id));

  // Hydrate rooms from DB on first mount
  useEffect(() => {
    if (hydrated) return;
    void (async () => {
      try {
        const res = await fetch("/api/rooms");
        if (!res.ok) return;
        const apiRooms = await res.json() as ApiRoom[];
        if (apiRooms.length > 0) {
          setRooms(apiRooms.map(apiRoomToChatRoom));
        }
        setHydrated(true);
      } catch (err) {
        console.error("[chat] rooms fetch failed:", err);
        setHydrated(true);
      }
    })();
  }, [hydrated, setRooms, setHydrated]);

  // Load messages when active room changes
  useEffect(() => {
    if (!activeRoomId || loadedRoomsRef.current.has(activeRoomId)) return;
    loadedRoomsRef.current.add(activeRoomId);

    void (async () => {
      try {
        const res = await fetch(`/api/rooms/${activeRoomId}/messages`);
        if (!res.ok) return;
        const apiMessages = await res.json() as ApiMessage[];
        const messages: Message[] = apiMessages.map((m) => ({
          id: m.id,
          chatId: activeRoomId,
          role: m.role === "user" ? "user" : m.role === "agent" ? "agent" : "system",
          agentId: m.agentId ?? undefined,
          content: m.content,
          reasoning: m.reasoning ?? undefined,
          timestamp: new Date(m.createdAt),
        }));
        // Only hydrate if the room is still empty (don't overwrite optimistic messages)
        const room = rooms.find((r) => r.id === activeRoomId);
        if (room && room.messages.length === 0 && messages.length > 0) {
          setRoomMessages(activeRoomId, messages);
        }
      } catch (err) {
        console.error("[chat] messages fetch failed:", err);
      }
    })();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRoomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeRoom?.messages.length, isThinking]);

  const handleSend = useCallback(async () => {
    if (!input.trim() || !activeRoomId || isThinking) return;

    const userContent = input.trim();
    setInput("");

    // Add user message (optimistic)
    addMessage(activeRoomId, {
      id: `msg-user-${Date.now()}`,
      chatId: activeRoomId,
      role: "user",
      content: userContent,
      timestamp: new Date(),
    });

    // Pick responding agent
    const mentionedAgent = parseMention(userContent, roomAgents);
    const respondingAgent = mentionedAgent ?? roomAgents[0];
    if (!respondingAgent) return;

    updateAgentStatus(respondingAgent.id, "busy");
    setIsThinking(true);

    // Build history from existing messages (skip system, last 20)
    const history = (activeRoom?.messages ?? [])
      .filter((m) => m.role !== "system")
      .slice(-20)
      .map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));
    history.push({ role: "user", content: userContent });

    let msgId: string | null = null;
    contentRef.current = "";

    try {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(anthropicKey && { "x-anthropic-key": anthropicKey }),
          ...(openaiKey && { "x-openai-key": openaiKey }),
          ...(openrouterKey && { "x-openrouter-key": openrouterKey }),
        },
        body: JSON.stringify({
          messages: history,
          agentId: respondingAgent.id,
          roomId: activeRoomId,
          userContent,
        }),
      });

      setIsThinking(false);
      msgId = `msg-agent-${Date.now()}`;
      setStreamingMsgId(msgId);

      addMessage(activeRoomId, {
        id: msgId,
        chatId: activeRoomId,
        role: "agent",
        agentId: respondingAgent.id,
        agentName: respondingAgent.name,
        agentColor: respondingAgent.color,
        agentAvatar: respondingAgent.avatar,
        content: "",
        timestamp: new Date(),
        isStreaming: true,
      });

      const { error } = await readSSEStream(response, (text) => {
        contentRef.current += text;
        updateMessage(activeRoomId, msgId!, { content: contentRef.current });
      });

      if (error) {
        updateMessage(activeRoomId, msgId, {
          content: `⚠ ${error}`,
          isStreaming: false,
        });
      } else {
        updateMessage(activeRoomId, msgId, { isStreaming: false });
      }
    } catch (err) {
      setIsThinking(false);
      const errorText =
        err instanceof Error ? err.message : "Failed to reach API";

      if (msgId) {
        updateMessage(activeRoomId, msgId, {
          content: `⚠ ${errorText}`,
          isStreaming: false,
        });
      } else {
        addMessage(activeRoomId, {
          id: `msg-err-${Date.now()}`,
          chatId: activeRoomId,
          role: "system",
          content: `⚠ ${errorText}`,
          timestamp: new Date(),
        });
      }
    } finally {
      setStreamingMsgId(null);
      updateAgentStatus(respondingAgent.id, "online");
    }
  }, [
    input,
    activeRoomId,
    isThinking,
    roomAgents,
    activeRoom?.messages,
    addMessage,
    updateMessage,
    updateAgentStatus,
    anthropicKey,
    openaiKey,
    openrouterKey,
  ]);

  const handleCreateRoom = useCallback(async () => {
    const name = `Room ${rooms.length + 1}`;
    try {
      const res = await fetch("/api/rooms", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, agentIds: ["hermes-lisa"] }),
      });
      if (res.ok) {
        const apiRoom = await res.json() as ApiRoom;
        const newRoom = apiRoomToChatRoom(apiRoom);
        // Add to store and switch to it
        createRoom(newRoom.name, newRoom.agents);
        // Replace the temp room with the DB-backed one
        setRooms([...rooms.map((r) => r), newRoom]);
        setActiveRoom(newRoom.id);
        return;
      }
    } catch {
      // fallback to client-only room
    }
    createRoom(name, ["hermes-lisa"]);
  }, [rooms, createRoom, setRooms, setActiveRoom]);

  return (
    <div className="flex h-full">
      {/* Room sidebar */}
      <div className="w-56 border-r border-[--border] flex flex-col bg-[--sidebar] shrink-0">
        <div className="p-3 border-b border-[--border] flex items-center justify-between">
          <span className="text-xs font-medium text-[--foreground]">Rooms</span>
          <Button
            size="icon"
            variant="ghost"
            className="h-6 w-6"
            onClick={handleCreateRoom}
          >
            <Plus className="w-3 h-3" />
          </Button>
        </div>
        <ScrollArea className="flex-1">
          <div className="p-2 space-y-0.5">
            {rooms.map((room) => {
              const roomAgentList = agents.filter((a) =>
                room.agents.includes(a.id)
              );
              return (
                <button
                  key={room.id}
                  onClick={() => setActiveRoom(room.id)}
                  className={cn(
                    "w-full text-left px-2.5 py-2.5 rounded-md transition-colors",
                    room.id === activeRoomId
                      ? "bg-[--primary]/15 text-[--primary]"
                      : "hover:bg-[--accent] text-[--muted-foreground] hover:text-[--foreground]"
                  )}
                >
                  <div className="flex items-center gap-1.5 mb-1">
                    <Users className="w-3 h-3 shrink-0" />
                    <span className="text-xs font-medium truncate">
                      {room.name}
                    </span>
                  </div>
                  <div className="flex items-center gap-1">
                    {roomAgentList.slice(0, 3).map((a) => (
                      <span key={a.id} className="text-[11px]" title={a.name}>
                        {a.avatar}
                      </span>
                    ))}
                    {room.messages.length > 0 && (
                      <span className="text-[10px] text-[--muted-foreground] ml-auto">
                        {room.messages.length} msgs
                      </span>
                    )}
                  </div>
                </button>
              );
            })}
          </div>
        </ScrollArea>
      </div>

      {/* Chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {activeRoom ? (
          <>
            {/* Room header */}
            <div className="h-14 border-b border-[--border] px-4 flex items-center gap-3 bg-[--card] shrink-0">
              <div className="flex items-center gap-2">
                <span className="font-medium text-sm text-[--foreground]">
                  {activeRoom.name}
                </span>
                <div className="flex items-center gap-1">
                  {roomAgents.map((a) => (
                    <div
                      key={a.id}
                      className="w-6 h-6 rounded-full flex items-center justify-center text-xs border border-[--border]"
                      style={{ backgroundColor: a.color + "22" }}
                      title={`${a.name} · ${a.status}`}
                    >
                      {a.avatar}
                    </div>
                  ))}
                </div>
              </div>
              <div className="ml-auto flex items-center gap-2">
                <Badge variant="outline" className="text-[10px] gap-1">
                  <div
                    className={cn(
                      "w-1.5 h-1.5 rounded-full",
                      streamingMsgId
                        ? "bg-amber-400 animate-pulse"
                        : "bg-emerald-400"
                    )}
                  />
                  {streamingMsgId ? "responding…" : `${roomAgents.length} agents`}
                </Badge>
                <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
                  <Bot className="w-3 h-3" />
                  Add Agent
                  <ChevronDown className="w-3 h-3" />
                </Button>
              </div>
            </div>

            {/* Messages */}
            <ScrollArea className="flex-1 p-4">
              <div className="space-y-4 max-w-3xl mx-auto">
                {activeRoom.messages.length === 0 && (
                  <div className="flex flex-col items-center justify-center py-16 text-center">
                    <div className="w-12 h-12 rounded-xl bg-[--primary]/10 flex items-center justify-center mb-4">
                      <Cpu className="w-6 h-6 text-[--primary]" />
                    </div>
                    <div className="text-sm font-medium text-[--foreground] mb-1">
                      {activeRoom.name}
                    </div>
                    <div className="text-xs text-[--muted-foreground] max-w-xs">
                      {roomAgents.map((a) => a.name).join(", ")}{" "}
                      {roomAgents.length === 1 ? "is" : "are"} ready. Start a
                      conversation or type @Agent to mention someone.
                    </div>
                  </div>
                )}
                {activeRoom.messages.map((msg) => (
                  <MessageBubble key={msg.id} message={msg} />
                ))}
                {isThinking && <ThinkingIndicator agent={roomAgents[0]} />}
                <div ref={messagesEndRef} />
              </div>
            </ScrollArea>

            {/* Input */}
            <div className="border-t border-[--border] p-4 bg-[--card] shrink-0">
              <div className="max-w-3xl mx-auto">
                <div className="flex items-end gap-2">
                  <div className="flex-1 relative">
                    <Input
                      value={input}
                      onChange={(e) => setInput(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" && !e.shiftKey) {
                          e.preventDefault();
                          handleSend();
                        }
                      }}
                      placeholder={`Message ${activeRoom.name}… (@Agent to mention)`}
                      className="pr-10 bg-[--muted] border-[--border] text-sm"
                      disabled={isThinking || !!streamingMsgId}
                    />
                    <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[--muted-foreground] hover:text-[--foreground]">
                      <AtSign className="w-3.5 h-3.5" />
                    </button>
                  </div>
                  <Button
                    onClick={handleSend}
                    disabled={!input.trim() || isThinking || !!streamingMsgId}
                    size="icon"
                    className="shrink-0"
                  >
                    {isThinking || streamingMsgId ? (
                      <Loader2 className="w-4 h-4 animate-spin" />
                    ) : (
                      <Send className="w-4 h-4" />
                    )}
                  </Button>
                </div>
                <div className="flex items-center gap-3 mt-2 px-1">
                  {roomAgents.map((a) => (
                    <button
                      key={a.id}
                      onClick={() =>
                        setInput((prev) =>
                          prev.trim()
                            ? `${prev} @${a.name} `
                            : `@${a.name} `
                        )
                      }
                      className="flex items-center gap-1 text-[10px] text-[--muted-foreground] hover:text-[--foreground] transition-colors"
                    >
                      <span>{a.avatar}</span>
                      <span>{a.name}</span>
                      {a.status === "busy" && (
                        <span className="text-amber-400">●</span>
                      )}
                    </button>
                  ))}
                  <span className="ml-auto text-[10px] text-[--muted-foreground]">
                    Enter to send · Shift+Enter for newline
                  </span>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center">
            <div className="text-center">
              <Users className="w-10 h-10 text-[--muted-foreground] mx-auto mb-3" />
              <div className="text-sm text-[--muted-foreground]">
                Select a room to start
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const [expanded, setExpanded] = useState(false);

  if (isSystem) {
    return (
      <div className="flex items-center gap-2 py-1 animate-fade-in">
        <div className="flex-1 h-px bg-[--border]" />
        <span className="text-[11px] text-[--muted-foreground] px-2 shrink-0 flex items-center gap-1">
          {message.content.startsWith("⚠") && (
            <AlertTriangle className="w-3 h-3 text-amber-400" />
          )}
          {message.content}
        </span>
        <div className="flex-1 h-px bg-[--border]" />
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3 animate-fade-in", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        {isUser ? (
          <div className="w-7 h-7 rounded-full bg-[--primary]/20 flex items-center justify-center text-xs text-[--primary] font-medium">
            U
          </div>
        ) : (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
            style={{ backgroundColor: (message.agentColor ?? "#666") + "22" }}
          >
            {message.agentAvatar ?? "🤖"}
          </div>
        )}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0", isUser && "flex flex-col items-end")}>
        {/* Header */}
        <div
          className={cn(
            "flex items-center gap-2 mb-1",
            isUser && "flex-row-reverse"
          )}
        >
          <span className="text-xs font-medium text-[--foreground]">
            {isUser ? "You" : (message.agentName ?? "Agent")}
          </span>
          <span className="text-[10px] text-[--muted-foreground]">
            {formatDistanceToNow(new Date(message.timestamp), {
              addSuffix: true,
            })}
          </span>
          {message.isStreaming && (
            <span className="text-[10px] text-amber-400 flex items-center gap-1">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              typing
            </span>
          )}
        </div>

        {/* Reasoning */}
        {message.reasoning && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[10px] text-[--muted-foreground] mb-1.5 hover:text-[--foreground] transition-colors"
          >
            <ChevronRight
              className={cn(
                "w-3 h-3 transition-transform",
                expanded && "rotate-90"
              )}
            />
            View reasoning
          </button>
        )}
        {message.reasoning && expanded && (
          <div className="mb-2 px-3 py-2 rounded-md border border-[--border] bg-[--muted] text-[11px] text-[--muted-foreground] italic">
            {message.reasoning}
          </div>
        )}

        {/* Bubble */}
        <div
          className={cn(
            "px-3.5 py-2.5 rounded-xl text-sm leading-relaxed max-w-[80%] whitespace-pre-wrap",
            isUser
              ? "bg-[--primary] text-white"
              : "bg-[--card] border border-[--border] text-[--foreground]",
            message.isStreaming && "border-[--primary]/40"
          )}
        >
          {message.content || (
            <span className="text-[--muted-foreground] italic">…</span>
          )}
          {message.isStreaming && (
            <span className="inline-block w-1 h-3.5 bg-[--primary] ml-0.5 animate-pulse rounded-sm align-middle" />
          )}
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <div
                key={tc.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[--muted] border border-[--border] text-[11px]"
              >
                <Wrench className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="text-amber-400 font-mono">{tc.name}</span>
                <Badge
                  variant={
                    tc.status === "complete"
                      ? "success"
                      : tc.status === "error"
                      ? "destructive"
                      : "secondary"
                  }
                  className="text-[9px] ml-auto"
                >
                  {tc.status}
                </Badge>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingIndicator({ agent }: { agent?: Agent }) {
  return (
    <div className="flex gap-3 animate-fade-in">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
        style={{ backgroundColor: (agent?.color ?? "#666") + "22" }}
      >
        {agent?.avatar ?? "🤖"}
      </div>
      <div className="bg-[--card] border border-[--border] rounded-xl px-4 py-3 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 text-[--muted-foreground] animate-spin" />
        <span className="text-xs text-[--muted-foreground]">
          {agent?.name ?? "Agent"} is thinking…
        </span>
      </div>
    </div>
  );
}
