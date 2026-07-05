"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { Users } from "lucide-react";
import { KnowledgeGraphPanel } from "@/components/knowledge/KnowledgeGraphPanel";
import { SuggestedKnowledgePanel } from "@/components/knowledge/SuggestedKnowledgePanel";
import { ChatRoomList } from "@/components/chat/ChatRoomList";
import { ChatHeader } from "@/components/chat/ChatHeader";
import { ChatMessageList } from "@/components/chat/ChatMessageList";
import { ChatComposer } from "@/components/chat/ChatComposer";
import type { ExtractionCandidate } from "@/lib/knowledge/types";
import { useChatStore } from "@/store/useChatStore";
import { useAgentStore } from "@/store/useAgentStore";
import { useKeyStore } from "@/store/useKeyStore";
import type { Message, Agent } from "@/types";

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
  onToken: (text: string) => void,
  onKnowledgeUpdate?: (roomId: string) => void,
  onPresence?: (agentId: string, status: "thinking" | "idle") => void
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
            | { type: "knowledge_update"; roomId?: string }
            | { type: "presence"; agentId: string; status: "thinking" | "idle" }
            | { type: "done" };

          if (parsed.type === "text") onToken(parsed.text);
          if (parsed.type === "error") return { error: parsed.error };
          // New: handle knowledge_update events
          if (parsed.type === "knowledge_update" && onKnowledgeUpdate) {
            const ku = parsed as { type: string; roomId?: string };
            onKnowledgeUpdate(ku.roomId ?? "");
          }
          if (parsed.type === "presence" && onPresence) {
            onPresence(parsed.agentId, parsed.status);
          }
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

function apiRoomToChatRoom(r: ApiRoom) {
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
  const [candidates, setCandidates] = useState<ExtractionCandidate[]>([]);
  const [showCandidates, setShowCandidates] = useState(false);
  const [showGraph, setShowGraph] = useState(false);
  const [graphRefreshKey, setGraphRefreshKey] = useState(0);
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

  // Reset candidates panel when room changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setCandidates([]);
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShowCandidates(false);
  }, [activeRoomId]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeRoom?.messages.length, isThinking]);

  // Run a single agent turn against an existing transcript — used for agent-to-agent
  // handoffs, where a second agent responds without the user sending a new message.
  const runAgentTurn = useCallback(
    async (
      agent: Agent,
      turnHistory: Array<{ role: "user" | "assistant"; content: string }>,
      roomId: string
    ) => {
      updateAgentStatus(agent.id, "busy");
      const handoffMsgId = `msg-agent-${Date.now()}-handoff`;
      let handoffContent = "";
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
            messages: turnHistory,
            agentId: agent.id,
            roomId,
            userContent: turnHistory[turnHistory.length - 1]?.content ?? "",
          }),
        });

        addMessage(roomId, {
          id: handoffMsgId,
          chatId: roomId,
          role: "agent",
          agentId: agent.id,
          agentName: agent.name,
          agentColor: agent.color,
          agentAvatar: agent.avatar,
          content: "",
          timestamp: new Date(),
          isStreaming: true,
        });

        await readSSEStream(
          response,
          (text) => {
            handoffContent += text;
            updateMessage(roomId, handoffMsgId, { content: handoffContent });
          },
          (updatedRoomId) => {
            if (updatedRoomId === roomId) setGraphRefreshKey((k) => k + 1);
          },
          (presenceAgentId, status) => {
            updateAgentStatus(presenceAgentId, status === "thinking" ? "busy" : "online");
          }
        );
        updateMessage(roomId, handoffMsgId, { isStreaming: false });
      } finally {
        updateAgentStatus(agent.id, "online");
      }
    },
    [addMessage, updateMessage, updateAgentStatus, anthropicKey, openaiKey, openrouterKey]
  );

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
      }, (updatedRoomId) => {
        if (updatedRoomId === activeRoomId) {
          setGraphRefreshKey(k => k + 1);
        }
      }, (presenceAgentId, status) => {
        updateAgentStatus(presenceAgentId, status === "thinking" ? "busy" : "online");
      });

      if (error) {
        updateMessage(activeRoomId, msgId, {
          content: `⚠ ${error}`,
          isStreaming: false,
        });
      } else {
        updateMessage(activeRoomId, msgId, { isStreaming: false });

        // Fire extraction in background — don't await, don't block UI
        const fullContent = contentRef.current;
        if (fullContent) {
          const capturedRoomId = activeRoomId;
          const capturedKey = anthropicKey;
          const capturedHistory = history.slice(-6);
          void (async () => {
            try {
              const res = await fetch("/api/knowledge/extract", {
                method: "POST",
                headers: {
                  "Content-Type": "application/json",
                  ...(capturedKey && { "x-anthropic-key": capturedKey }),
                },
                body: JSON.stringify({
                  messages: capturedHistory,
                  roomId: capturedRoomId,
                }),
              });
              if (res.ok) {
                const data = await res.json() as { candidates: ExtractionCandidate[] };
                if (data.candidates.length > 0) {
                  setCandidates(data.candidates);
                  setShowCandidates(true);
                }
              }
            } catch {
              // non-fatal
            }
          })();
        }

        // Agent-to-agent handoff: if the reply @mentions a *different* room agent,
        // let that agent respond once (single hop — no further chained handoffs).
        const handoffTarget = fullContent
          ? parseMention(fullContent, roomAgents.filter((a) => a.id !== respondingAgent.id))
          : null;
        if (handoffTarget) {
          const handoffHistory = [
            ...history,
            { role: "assistant" as const, content: fullContent },
          ];
          void runAgentTurn(handoffTarget, handoffHistory, activeRoomId);
        }
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
    runAgentTurn,
  ]);

  const handleAcceptCandidate = useCallback(async (candidate: ExtractionCandidate) => {
    setCandidates(prev => prev.filter(c => c.id !== candidate.id));
    try {
      await fetch("/api/knowledge/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "accept", candidate, roomId: activeRoomId }),
      });
      setGraphRefreshKey(k => k + 1);
    } catch { /* non-fatal */ }
  }, [activeRoomId]);

  const handleRejectCandidate = useCallback(async (candidate: ExtractionCandidate) => {
    setCandidates(prev => prev.filter(c => c.id !== candidate.id));
    try {
      await fetch("/api/knowledge/candidates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "reject", candidate }),
      });
    } catch { /* non-fatal */ }
  }, []);

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

  const handleMentionAgent = useCallback((agentName: string) => {
    setInput((prev) => prev.trim() ? `${prev} @${agentName} ` : `@${agentName} `);
  }, []);

  return (
    <div className="flex h-full overflow-hidden">
      <ChatRoomList
        rooms={rooms}
        activeRoomId={activeRoomId}
        agents={agents}
        onSelectRoom={setActiveRoom}
        onCreateRoom={handleCreateRoom}
      />

      {/* Chat area */}
      <div className="flex flex-col flex-1 min-w-0">
        {activeRoom ? (
          <>
            <ChatHeader
              room={activeRoom}
              agents={roomAgents}
              isStreaming={!!streamingMsgId}
              showGraph={showGraph}
              onToggleGraph={() => setShowGraph(!showGraph)}
            />

            <ChatMessageList
              room={activeRoom}
              agents={roomAgents}
              isThinking={isThinking}
              messagesEndRef={messagesEndRef}
            />

            {/* Knowledge extraction candidates */}
            {showCandidates && candidates.length > 0 && (
              <SuggestedKnowledgePanel
                candidates={candidates}
                onAccept={handleAcceptCandidate}
                onReject={handleRejectCandidate}
                onDismiss={() => { setCandidates([]); setShowCandidates(false); }}
              />
            )}

            <ChatComposer
              room={activeRoom}
              agents={roomAgents}
              input={input}
              isThinking={isThinking}
              isStreaming={!!streamingMsgId}
              onInputChange={setInput}
              onSend={handleSend}
              onMentionAgent={handleMentionAgent}
              onTranscript={(text) => setInput(text)}
            />
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
      {showGraph && (
        <div className="w-80 shrink-0">
          <KnowledgeGraphPanel
            roomId={activeRoomId ?? undefined}
            isStreaming={!!streamingMsgId}
            refreshKey={graphRefreshKey}
            onClose={() => setShowGraph(false)}
          />
        </div>
      )}
    </div>
  );
}
