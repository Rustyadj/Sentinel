"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Send,
  Plus,
  Bot,
  MessageSquare,
  ChevronRight,
  ChevronDown,
  Folder,
  FolderOpen,
  Hash,
  Loader2,
  AlertTriangle,
  Brain,
  Cpu,
  Trash2,
  Circle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAgentStore } from "@/store/useAgentStore";
import { useMemoryStore } from "@/store/useMemoryStore";
import { useKeyStore } from "@/store/useKeyStore";
import { AGENT_TEMPLATES } from "@/lib/constants";
import { KnowledgeGraph } from "./KnowledgeGraph";
import { Network } from "lucide-react";
import type { Agent } from "@/types";

// ─── Types ────────────────────────────────────────────────────────────────────

interface Project {
  id: string;
  name: string;
  description: string;
  status: string;
  agents: string[];
  tags: string[];
}

interface Room {
  id: string;
  name: string;
  projectId?: string | null;
  agentIds: string[];
  createdAt: string;
}

interface ChatMessage {
  id: string;
  role: "user" | "agent" | "system";
  agentId?: string;
  content: string;
  createdAt?: string;
  isStreaming?: boolean;
  error?: boolean;
}

// ─── SSE helper ──────────────────────────────────────────────────────────────

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
          const parsed = JSON.parse(raw) as { type: string; text?: string; error?: string };
          if (parsed.type === "text" && parsed.text) onToken(parsed.text);
          if (parsed.type === "error") return { error: parsed.error };
        } catch {
          /* ignore malformed */
        }
      }
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : "Stream error" };
  } finally {
    reader.releaseLock();
  }
  return {};
}

// ─── Room item ────────────────────────────────────────────────────────────────

function RoomItem({
  room,
  active,
  hovered,
  onHover,
  onSelect,
  onDelete,
  indent,
}: {
  room: Room;
  active: boolean;
  hovered: boolean;
  onHover: (id: string | null) => void;
  onSelect: () => void;
  onDelete: () => void;
  indent?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex items-center gap-1.5 px-2 py-1.5 cursor-pointer rounded-md mx-1 group transition-colors",
        indent && "ml-4",
        active
          ? "bg-indigo-500/15 text-indigo-700"
          : "hover:bg-[--accent] text-[--muted-foreground]"
      )}
      onMouseEnter={() => onHover(room.id)}
      onMouseLeave={() => onHover(null)}
      onClick={onSelect}
    >
      <Hash
        className={cn(
          "w-3 h-3 shrink-0",
          active ? "text-indigo-500" : "text-[--muted-foreground] opacity-50"
        )}
      />
      <span className="text-xs truncate flex-1">{room.name}</span>
      {hovered && !active && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          className="w-4 h-4 flex items-center justify-center text-[--muted-foreground] hover:text-red-500 transition-colors"
        >
          <Trash2 className="w-3 h-3" />
        </button>
      )}
    </div>
  );
}

// ─── Left panel ───────────────────────────────────────────────────────────────

function LeftPanel({
  projects,
  rooms,
  activeRoomId,
  onSelectRoom,
  onCreateProject,
  onCreateRoom,
  onDeleteRoom,
}: {
  projects: Project[];
  rooms: Room[];
  activeRoomId: string | null;
  activeProjectId: string | null;
  onSelectRoom: (room: Room) => void;
  onCreateProject: () => void;
  onCreateRoom: (projectId?: string) => void;
  onDeleteRoom: (roomId: string) => void;
}) {
  const [expanded, setExpanded] = useState<Set<string>>(
    new Set(projects.map((p) => p.id))
  );
  const [hoveredRoom, setHoveredRoom] = useState<string | null>(null);

  // Expand new projects automatically — functional setState in effect is intentional
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    setExpanded((prev) => {
      const next = new Set(prev);
      projects.forEach((p) => next.add(p.id));
      return next;
    });
  }, [projects]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function toggleProject(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }

  const ungroupedRooms = rooms.filter((r) => !r.projectId);

  return (
    <div className="w-60 flex flex-col h-full bg-[--sidebar] border-r border-[--border] overflow-hidden shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-3 border-b border-[--border]">
        <span className="text-[11px] font-semibold text-[--muted-foreground] uppercase tracking-wider">
          Workspaces
        </span>
        <button
          onClick={onCreateProject}
          className="w-6 h-6 rounded-md bg-indigo-500/15 hover:bg-indigo-500/25 flex items-center justify-center text-indigo-500 transition-colors"
          title="New Project"
        >
          <Plus className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* List */}
      <div className="flex-1 overflow-y-auto py-2">
        {/* Project groups */}
        {projects.map((project) => {
          const projectRooms = rooms.filter((r) => r.projectId === project.id);
          const isExpanded = expanded.has(project.id);
          return (
            <div key={project.id}>
              <div
                className="flex items-center gap-1.5 px-2 py-1.5 cursor-pointer hover:bg-[--accent] group rounded-md mx-1 transition-colors"
                onClick={() => toggleProject(project.id)}
              >
                {isExpanded ? (
                  <ChevronDown className="w-3 h-3 text-[--muted-foreground] shrink-0" />
                ) : (
                  <ChevronRight className="w-3 h-3 text-[--muted-foreground] shrink-0" />
                )}
                {isExpanded ? (
                  <FolderOpen className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
                ) : (
                  <Folder className="w-3.5 h-3.5 text-[--muted-foreground] shrink-0" />
                )}
                <span className="text-xs font-medium text-[--foreground] truncate flex-1">
                  {project.name}
                </span>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    onCreateRoom(project.id);
                  }}
                  className="opacity-0 group-hover:opacity-100 w-5 h-5 rounded flex items-center justify-center text-[--muted-foreground] hover:text-indigo-500 transition-all"
                >
                  <Plus className="w-3 h-3" />
                </button>
              </div>
              {isExpanded &&
                projectRooms.map((room) => (
                  <RoomItem
                    key={room.id}
                    room={room}
                    active={activeRoomId === room.id}
                    hovered={hoveredRoom === room.id}
                    onHover={setHoveredRoom}
                    onSelect={() => onSelectRoom(room)}
                    onDelete={() => onDeleteRoom(room.id)}
                    indent
                  />
                ))}
              {isExpanded && projectRooms.length === 0 && (
                <div className="pl-10 pr-2 py-1">
                  <button
                    onClick={() => onCreateRoom(project.id)}
                    className="text-[10px] text-[--muted-foreground] hover:text-indigo-500 transition-colors"
                  >
                    + New room
                  </button>
                </div>
              )}
            </div>
          );
        })}

        {/* Ungrouped rooms */}
        {ungroupedRooms.length > 0 && (
          <div className="mt-2">
            <div className="px-3 pb-1">
              <span className="text-[9px] uppercase tracking-widest text-[--muted-foreground] font-medium opacity-60">
                General
              </span>
            </div>
            {ungroupedRooms.map((room) => (
              <RoomItem
                key={room.id}
                room={room}
                active={activeRoomId === room.id}
                hovered={hoveredRoom === room.id}
                onHover={setHoveredRoom}
                onSelect={() => onSelectRoom(room)}
                onDelete={() => onDeleteRoom(room.id)}
              />
            ))}
          </div>
        )}

        {/* Empty state */}
        {projects.length === 0 && rooms.length === 0 && (
          <div className="px-3 py-6 text-center">
            <MessageSquare className="w-8 h-8 text-[--muted-foreground] opacity-30 mx-auto mb-2" />
            <div className="text-xs text-[--muted-foreground]">No projects yet</div>
            <button
              onClick={onCreateProject}
              className="mt-2 text-xs text-indigo-500 hover:underline"
            >
              Create one
            </button>
          </div>
        )}
      </div>

      {/* New Room (general) */}
      <div className="border-t border-[--border] p-2">
        <button
          onClick={() => onCreateRoom()}
          className="w-full flex items-center gap-2 px-2 py-2 rounded-lg text-xs text-[--muted-foreground] hover:bg-[--accent] hover:text-[--foreground] transition-colors"
        >
          <Plus className="w-3.5 h-3.5" />
          New chat
        </button>
      </div>
    </div>
  );
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({
  msg,
  agent,
}: {
  msg: ChatMessage;
  agent?: Agent;
}) {
  const isUser = msg.role === "user";

  if (msg.role === "system") {
    return (
      <div className="flex items-center gap-2 py-1">
        <div className="flex-1 h-px bg-[--border]" />
        <span className="text-[11px] text-[--muted-foreground] px-2 shrink-0">
          {msg.content}
        </span>
        <div className="flex-1 h-px bg-[--border]" />
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3 group", isUser ? "flex-row-reverse" : "flex-row")}>
      {/* Avatar */}
      {!isUser && (
        <div
          className="w-8 h-8 rounded-full flex items-center justify-center text-sm shrink-0 mt-0.5 border border-[--border]"
          style={{ backgroundColor: (agent?.color ?? "#6366f1") + "22" }}
        >
          {agent?.avatar ?? <Bot className="w-4 h-4 text-[--muted-foreground]" />}
        </div>
      )}

      <div className={cn("flex flex-col gap-1 max-w-[70%]", isUser && "items-end")}>
        {/* Name */}
        {!isUser && agent && (
          <div className="flex items-center gap-2">
            <span className="text-[11px] font-semibold" style={{ color: agent.color }}>
              {agent.name}
            </span>
            <span className="text-[10px] text-[--muted-foreground]">{agent.role}</span>
          </div>
        )}

        {/* Bubble */}
        <div
          className={cn(
            "rounded-2xl px-4 py-2.5 text-sm leading-relaxed",
            isUser
              ? "bg-indigo-600 text-white rounded-tr-sm"
              : msg.error
              ? "bg-red-500/10 text-red-400 border border-red-500/20 rounded-tl-sm"
              : "bg-[--card] text-[--foreground] border border-[--border] rounded-tl-sm"
          )}
        >
          {msg.error && (
            <AlertTriangle className="w-3.5 h-3.5 inline mr-1.5 -mt-0.5" />
          )}
          {msg.content ||
            (msg.isStreaming ? (
              <span className="flex items-center gap-2 text-[--muted-foreground]">
                <Loader2 className="w-3.5 h-3.5 animate-spin" /> Thinking…
              </span>
            ) : (
              ""
            ))}
          {msg.isStreaming && msg.content && (
            <span className="inline-block w-1 h-4 bg-indigo-400 ml-0.5 animate-pulse rounded-sm" />
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Right context panel ──────────────────────────────────────────────────────

function RightPanel({
  activeAgent,
  activeProject,
  recentMemories,
}: {
  activeAgent: Agent | null;
  activeProject: Project | null;
  recentMemories: { id: string; content: string; type: string; confidence: number }[];
}) {
  const [tab, setTab] = useState<"context" | "graph">("context");

  return (
    <div className="w-64 flex flex-col h-full bg-[--sidebar] border-l border-[--border] overflow-hidden shrink-0">
      {/* Tab bar */}
      <div className="flex border-b border-[--border] shrink-0">
        <button
          onClick={() => setTab("context")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] uppercase tracking-wide transition-colors border-b-2",
            tab === "context" ? "border-indigo-500 text-indigo-400" : "border-transparent text-[--muted-foreground] hover:text-[--foreground]"
          )}
        >
          <Brain className="w-3 h-3" /> Context
        </button>
        <button
          onClick={() => setTab("graph")}
          className={cn(
            "flex-1 flex items-center justify-center gap-1.5 py-2 text-[10px] uppercase tracking-wide transition-colors border-b-2",
            tab === "graph" ? "border-indigo-500 text-indigo-400" : "border-transparent text-[--muted-foreground] hover:text-[--foreground]"
          )}
        >
          <Network className="w-3 h-3" /> Graph
        </button>
      </div>

      {/* Knowledge graph tab */}
      {tab === "graph" && (
        <div className="flex-1 p-2 overflow-hidden">
          <KnowledgeGraph className="h-full" />
        </div>
      )}

      {/* Context tab */}
      {tab === "context" && <>
      {/* Active agent */}
      <div className="p-3 border-b border-[--border]">
        <div className="text-[9px] uppercase tracking-widest text-[--muted-foreground] font-medium mb-2">
          Active Agent
        </div>
        {activeAgent ? (
          <div className="bg-[--card] rounded-xl p-3 border border-[--border]">
            <div className="flex items-center gap-2.5">
              <div
                className="w-9 h-9 rounded-full flex items-center justify-center text-base border border-[--border]"
                style={{ backgroundColor: activeAgent.color + "22" }}
              >
                {activeAgent.avatar}
              </div>
              <div className="min-w-0">
                <div className="text-sm font-semibold text-[--foreground] truncate">
                  {activeAgent.name}
                </div>
                <div className="text-[10px] text-[--muted-foreground] truncate">
                  {activeAgent.role}
                </div>
              </div>
            </div>
            <div className="mt-2 flex items-center gap-1.5">
              <div className="w-1.5 h-1.5 rounded-full bg-emerald-400" />
              <span className="text-[10px] text-[--muted-foreground]">
                {activeAgent.model}
              </span>
            </div>
          </div>
        ) : (
          <div className="text-xs text-[--muted-foreground] text-center py-2">
            No agent selected
          </div>
        )}
      </div>

      {/* Project info */}
      {activeProject && (
        <div className="p-3 border-b border-[--border]">
          <div className="text-[9px] uppercase tracking-widest text-[--muted-foreground] font-medium mb-2">
            Project
          </div>
          <div className="bg-[--card] rounded-xl p-3 border border-[--border]">
            <div className="flex items-center gap-2 mb-1">
              <Folder className="w-3.5 h-3.5 text-indigo-500 shrink-0" />
              <span className="text-sm font-medium text-[--foreground] truncate">
                {activeProject.name}
              </span>
            </div>
            {activeProject.description && (
              <div className="text-[10px] text-[--muted-foreground] line-clamp-2">
                {activeProject.description}
              </div>
            )}
            <div className="mt-2 flex flex-wrap gap-1">
              {activeProject.tags?.slice(0, 3).map((tag: string) => (
                <span
                  key={tag}
                  className="text-[9px] bg-indigo-500/10 text-indigo-500 px-1.5 py-0.5 rounded-md"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Memory context */}
      <div className="flex-1 p-3 overflow-y-auto">
        <div className="text-[9px] uppercase tracking-widest text-[--muted-foreground] font-medium mb-2 flex items-center gap-1.5">
          <Brain className="w-3 h-3" /> Memory Context
        </div>
        <div className="space-y-2">
          {recentMemories.slice(0, 5).map((mem) => (
            <div
              key={mem.id}
              className="bg-[--card] rounded-lg p-2.5 border border-[--border]"
            >
              <div className="text-[10px] text-[--foreground] line-clamp-2 leading-relaxed">
                {mem.content}
              </div>
              <div className="flex items-center gap-2 mt-1.5">
                <span className="text-[9px] bg-[--muted] text-[--muted-foreground] px-1.5 py-0.5 rounded capitalize">
                  {mem.type}
                </span>
                <span className="text-[9px] text-[--muted-foreground]">
                  {Math.round(mem.confidence * 100)}% conf.
                </span>
              </div>
            </div>
          ))}
          {recentMemories.length === 0 && (
            <div className="text-xs text-[--muted-foreground] text-center py-3">
              No memories yet
            </div>
          )}
        </div>
      </div>
      </>}
    </div>
  );
}

// ─── Main ChatPage ────────────────────────────────────────────────────────────

export function ChatPage() {
  const { agents } = useAgentStore();
  const { memories } = useMemoryStore();
  const { anthropicKey, openaiKey, openrouterKey } = useKeyStore();

  const [projects, setProjects] = useState<Project[]>([]);
  const [rooms, setRooms] = useState<Room[]>([]);
  const [activeRoom, setActiveRoom] = useState<Room | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [selectedAgentId, setSelectedAgentId] = useState(
    AGENT_TEMPLATES[0]?.id ?? "hermes-lisa"
  );
  const [agentDropdownOpen, setAgentDropdownOpen] = useState(false);

  const messagesEndRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Resolve active agent — prefer live agents store, fall back to template
  const activeAgent: Agent | null =
    agents.find((a) => a.id === selectedAgentId) ??
    (AGENT_TEMPLATES.find((t) => t.id === selectedAgentId)
      ? { ...AGENT_TEMPLATES.find((t) => t.id === selectedAgentId)!, status: "online" as const }
      : null);

  const selectedTemplate = AGENT_TEMPLATES.find((a) => a.id === selectedAgentId);

  const activeProject = activeRoom?.projectId
    ? projects.find((p) => p.id === activeRoom.projectId) ?? null
    : null;

  const recentMemories = memories.slice(0, 8).map((m) => ({
    id: m.id,
    content: m.content,
    type: m.type,
    confidence: m.confidence,
  }));

  // Load projects + rooms on mount
  useEffect(() => {
    void Promise.all([
      fetch("/api/projects")
        .then((r) => r.json())
        .catch(() => []),
      fetch("/api/rooms")
        .then((r) => r.json())
        .catch(() => []),
    ]).then(([proj, rm]) => {
      setProjects(proj as Project[]);
      setRooms(rm as Room[]);
    });
  }, []);

  // Auto-scroll
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  // Load room messages
  const selectRoom = useCallback(async (room: Room) => {
    setActiveRoom(room);
    setMessages([]);
    try {
      const res = await fetch(`/api/rooms/${room.id}/messages`);
      if (!res.ok) return;
      const data = (await res.json()) as Array<{
        id: string;
        role: string;
        agentId?: string | null;
        content: string;
        createdAt: string;
      }>;
      setMessages(
        Array.isArray(data)
          ? data.map((m) => ({
              id: m.id,
              role: (m.role === "user"
                ? "user"
                : m.role === "agent"
                ? "agent"
                : "system") as ChatMessage["role"],
              agentId: m.agentId ?? undefined,
              content: m.content,
              createdAt: m.createdAt,
            }))
          : []
      );
    } catch {
      setMessages([]);
    }
  }, []);

  const createProject = useCallback(async () => {
    const name = window.prompt("Project name:");
    if (!name?.trim()) return;
    try {
      const res = await fetch("/api/projects", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: name.trim(), description: "" }),
      });
      if (!res.ok) return;
      const project = (await res.json()) as Project;
      setProjects((prev) => [project, ...prev]);
    } catch (err) {
      console.error("[chat] createProject failed:", err);
    }
  }, []);

  const createRoom = useCallback(
    async (projectId?: string) => {
      const name = window.prompt("Room name:", "New Chat");
      if (!name?.trim()) return;
      try {
        const res = await fetch("/api/rooms", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: name.trim(),
            projectId: projectId ?? null,
            agentIds: [selectedAgentId],
          }),
        });
        if (!res.ok) return;
        const room = (await res.json()) as Room;
        setRooms((prev) => [room, ...prev]);
        void selectRoom(room);
      } catch (err) {
        console.error("[chat] createRoom failed:", err);
      }
    },
    [selectedAgentId, selectRoom]
  );

  const deleteRoom = useCallback(
    (roomId: string) => {
      setRooms((prev) => prev.filter((r) => r.id !== roomId));
      if (activeRoom?.id === roomId) {
        setActiveRoom(null);
        setMessages([]);
      }
    },
    [activeRoom]
  );

  const sendMessage = useCallback(async () => {
    if (!input.trim() || sending) return;
    const content = input.trim();
    setInput("");
    setSending(true);

    const userMsg: ChatMessage = {
      id: `user-${Date.now()}`,
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };

    const agentMsgId = `agent-${Date.now()}`;
    const agentMsg: ChatMessage = {
      id: agentMsgId,
      role: "agent",
      agentId: selectedAgentId,
      content: "",
      isStreaming: true,
    };

    setMessages((prev) => [...prev, userMsg, agentMsg]);

    // Build history (last 20 non-system messages)
    const history = messages
      .filter((m) => m.role !== "system")
      .slice(-20)
      .map((m) => ({
        role: (m.role === "user" ? "user" : "assistant") as "user" | "assistant",
        content: m.content,
      }));
    history.push({ role: "user", content });

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
          agentId: selectedAgentId,
          roomId: activeRoom?.id,
          userContent: content,
        }),
      });

      let fullContent = "";
      const { error } = await readSSEStream(response, (token) => {
        fullContent += token;
        setMessages((prev) =>
          prev.map((m) =>
            m.id === agentMsgId ? { ...m, content: fullContent } : m
          )
        );
      });

      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? {
                ...m,
                content: error ? `Error: ${error}` : fullContent,
                isStreaming: false,
                error: !!error,
              }
            : m
        )
      );
    } catch (err) {
      setMessages((prev) =>
        prev.map((m) =>
          m.id === agentMsgId
            ? {
                ...m,
                content: `Error: ${err instanceof Error ? err.message : "Unknown error"}`,
                isStreaming: false,
                error: true,
              }
            : m
        )
      );
    } finally {
      setSending(false);
      inputRef.current?.focus();
    }
  }, [
    input,
    sending,
    selectedAgentId,
    messages,
    activeRoom,
    anthropicKey,
    openaiKey,
    openrouterKey,
  ]);

  return (
    <div className="h-full flex overflow-hidden">
      {/* Left: Projects + Rooms */}
      <LeftPanel
        projects={projects}
        rooms={rooms}
        activeRoomId={activeRoom?.id ?? null}
        activeProjectId={activeRoom?.projectId ?? null}
        onSelectRoom={selectRoom}
        onCreateProject={createProject}
        onCreateRoom={createRoom}
        onDeleteRoom={deleteRoom}
      />

      {/* Center: Chat */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {/* Chat header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[--border] bg-[--card] shrink-0">
          <div className="flex items-center gap-2">
            {activeRoom ? (
              <>
                <Hash className="w-4 h-4 text-[--muted-foreground]" />
                <span className="text-sm font-semibold text-[--foreground]">
                  {activeRoom.name}
                </span>
                {activeProject && (
                  <span className="text-xs text-[--muted-foreground]">
                    · {activeProject.name}
                  </span>
                )}
              </>
            ) : (
              <>
                <Cpu className="w-4 h-4 text-indigo-500" />
                <span className="text-sm font-semibold text-[--foreground]">
                  Sentinel OS Chat
                </span>
              </>
            )}
          </div>

          {/* Agent selector */}
          <div className="relative">
            <button
              onClick={() => setAgentDropdownOpen((o) => !o)}
              className="flex items-center gap-2 bg-[--muted] hover:bg-[--accent] border border-[--border] rounded-lg px-2.5 py-1.5 text-xs transition-colors"
            >
              <div
                className="w-4 h-4 rounded-full flex items-center justify-center text-[10px]"
                style={{
                  backgroundColor:
                    (activeAgent?.color ?? "#6366f1") + "22",
                }}
              >
                {selectedTemplate?.avatar ?? "🤖"}
              </div>
              <span className="text-[--foreground] font-medium">
                {selectedTemplate?.name ?? "Select Agent"}
              </span>
              <ChevronDown className="w-3 h-3 text-[--muted-foreground]" />
            </button>

            {agentDropdownOpen && (
              <div className="absolute right-0 top-full mt-1 w-56 bg-[--card] border border-[--border] rounded-xl shadow-xl z-50 overflow-hidden py-1">
                {AGENT_TEMPLATES.map((a) => (
                  <button
                    key={a.id}
                    onClick={() => {
                      setSelectedAgentId(a.id);
                      setAgentDropdownOpen(false);
                    }}
                    className={cn(
                      "w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors",
                      selectedAgentId === a.id
                        ? "bg-indigo-500/10"
                        : "hover:bg-[--accent]"
                    )}
                  >
                    <div
                      className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
                      style={{ backgroundColor: a.color + "22" }}
                    >
                      {a.avatar}
                    </div>
                    <div>
                      <div className="text-xs font-medium text-[--foreground]">
                        {a.name}
                      </div>
                      <div className="text-[10px] text-[--muted-foreground]">
                        {a.model}
                      </div>
                    </div>
                    {selectedAgentId === a.id && (
                      <Circle className="w-2 h-2 fill-indigo-500 text-indigo-500 ml-auto" />
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto px-4 py-4 space-y-4"
          onClick={() => setAgentDropdownOpen(false)}
        >
          {messages.length === 0 && (
            <div className="flex flex-col items-center justify-center h-full text-center">
              <div className="w-14 h-14 rounded-2xl bg-indigo-500/10 border border-indigo-500/20 flex items-center justify-center mb-4">
                <Cpu className="w-7 h-7 text-indigo-500" />
              </div>
              <div className="text-sm font-semibold text-[--foreground] mb-1">
                {activeRoom ? activeRoom.name : "Start a conversation"}
              </div>
              <div className="text-xs text-[--muted-foreground] max-w-xs">
                {selectedTemplate
                  ? `Talking with ${selectedTemplate.name} · ${selectedTemplate.role}`
                  : "Select an agent to begin"}
              </div>
            </div>
          )}
          {messages.map((msg) => {
            const agent =
              msg.agentId
                ? (agents.find((a) => a.id === msg.agentId) ??
                    (AGENT_TEMPLATES.find((a) => a.id === msg.agentId)
                      ? ({
                          ...AGENT_TEMPLATES.find((a) => a.id === msg.agentId)!,
                          status: "online" as const,
                        } as Agent)
                      : undefined))
                : undefined;
            return <MessageBubble key={msg.id} msg={msg} agent={agent} />;
          })}
          <div ref={messagesEndRef} />
        </div>

        {/* Input */}
        <div className="border-t border-[--border] bg-[--card] px-4 py-3 shrink-0">
          <div className="flex items-center gap-2 bg-[--muted] border border-[--border] rounded-2xl px-3 py-2 focus-within:border-indigo-500/50 focus-within:ring-2 focus-within:ring-indigo-500/10 transition-all">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs shrink-0"
              style={{ backgroundColor: (activeAgent?.color ?? "#6366f1") + "22" }}
            >
              {activeAgent?.avatar ?? "🤖"}
            </div>
            <input
              ref={inputRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  void sendMessage();
                }
              }}
              placeholder={`Message ${selectedTemplate?.name ?? "agent"}…`}
              className="flex-1 bg-transparent text-sm text-[--foreground] placeholder:text-[--muted-foreground] outline-none"
            />
            <button
              onClick={() => void sendMessage()}
              disabled={!input.trim() || sending}
              className="w-8 h-8 rounded-xl bg-indigo-600 hover:bg-indigo-700 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors shrink-0"
            >
              {sending ? (
                <Loader2 className="w-3.5 h-3.5 text-white animate-spin" />
              ) : (
                <Send className="w-3.5 h-3.5 text-white" />
              )}
            </button>
          </div>
          <div className="mt-1.5 px-1 text-[10px] text-[--muted-foreground]">
            Press Enter to send · Shift+Enter for newline
          </div>
        </div>
      </div>

      {/* Right: Context panel */}
      <RightPanel
        activeAgent={activeAgent}
        activeProject={activeProject}
        recentMemories={recentMemories}
      />
    </div>
  );
}
