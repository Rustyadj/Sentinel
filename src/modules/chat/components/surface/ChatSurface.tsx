"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PanelLeft, Plus } from "lucide-react";
import { useChatSession } from "@/lib/chat/useChatSession";
import { useShellStore } from "@/store/useShellStore";
import { AppShell } from "@/components/shell/AppShell";
import { AgentSelector } from "@/components/shell/AgentSelector";
import { ContextChip, type ContextEntry } from "@/components/shell/ContextChip";
import { ConversationDrawer } from "@/components/shell/ConversationDrawer";
import { EmptyState, IconButton } from "@/components/shell/primitives";
import { GlobeStage } from "@/components/orrery/GlobeStage";
import { ActivityPanel, type FeedEvent, type PanelAgent } from "@/components/orrery/ActivityPanel";
import { cn } from "@/lib/utils";
import { ConversationMessage } from "./ConversationMessage";
import { Composer, type ComposerAction } from "./Composer";

/**
 * Sentinel's default surface. The conversation owns the screen; agent,
 * context and history are one click away in the top bar, and the composer
 * hides everything that is not typing behind a single "+".
 */
export function ChatSurface() {
  const session = useChatSession();
  const searchParams = useSearchParams();
  const { setConversationDrawerOpen, openInspector } = useShellStore();
  const scrollRef = useRef<HTMLDivElement>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const handledNewRef = useRef(false);
  const [followId, setFollowId] = useState<string | null>(null);
  const [focusChat, setFocusChat] = useState(false);

  const {
    rooms, activeRoom, activeRoomId, agents, roomAgents, activeAgent, selectedAgentIds,
    toggleSelectedAgent, input, setInput, isThinking, isStreaming, isHydrating, offline,
    setActiveRoom, handleSend, handleCreateRoom,
  } = session;

  // ?new=1 (command palette / Ctrl+N) starts a conversation exactly once.
  useEffect(() => {
    if (searchParams.get("new") !== "1" || handledNewRef.current || isHydrating) return;
    handledNewRef.current = true;
    void handleCreateRoom();
  }, [searchParams, isHydrating, handleCreateRoom]);

  // ?room=<id> deep links from search and the palette.
  useEffect(() => {
    const roomId = searchParams.get("room");
    if (roomId && roomId !== activeRoomId && rooms.some((room) => room.id === roomId)) {
      setActiveRoom(roomId);
    }
  }, [searchParams, activeRoomId, rooms, setActiveRoom]);

  const messages = useMemo(() => activeRoom?.messages ?? [], [activeRoom]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 1 ? "smooth" : "auto", block: "end" });
  }, [messages.length, isStreaming]);

  const agentNameById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );

  const busy = isThinking || isStreaming;
  // Whoever is streaming a reply is the working agent; before the first token
  // it is the agent the next message was routed to.
  const workingAgentId = useMemo(() => {
    if (!busy) return null;
    const streaming = [...messages].reverse().find((m) => m.isStreaming && m.agentId);
    return streaming?.agentId ?? activeAgent?.id ?? null;
  }, [busy, messages, activeAgent]);

  const globeAgents = useMemo(
    () => agents.map((a) => ({ id: a.id, name: a.name, color: a.color, working: a.id === workingAgentId })),
    [agents, workingAgentId],
  );

  const panelAgents: PanelAgent[] = useMemo(() => agents.map((a) => {
    const working = a.id === workingAgentId;
    return {
      id: a.id, name: a.name, color: a.color, model: a.model,
      state: working ? "working" : a.status === "offline" ? "offline" : "idle",
      detail: working ? (isStreaming ? "Writing a reply" : "Thinking") : a.role,
    };
  }), [agents, workingAgentId, isStreaming]);

  const feed: FeedEvent[] = useMemo(() => messages
    .filter((m) => m.role !== "system" && m.content.trim())
    .slice(-30)
    .reverse()
    .map((m) => {
      const isUser = m.role === "user";
      const agent = m.agentId ? agents.find((a) => a.id === m.agentId) : undefined;
      return {
        id: m.id,
        agentName: isUser ? "You" : agent?.name ?? m.agentName ?? "Agent",
        color: isUser ? "var(--primary-soft)" : agent?.color ?? m.agentColor ?? "var(--muted-foreground)",
        verb: isUser ? "send" : m.isStreaming ? "write" : "reply",
        text: m.content.replace(/\s+/g, " ").trim(),
        time: new Date(m.timestamp).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", hour12: false }),
      };
    }), [messages, agents]);

  const contextEntries: ContextEntry[] = useMemo(() => [
    {
      type: "conversation", label: "Conversation", value: activeRoom?.name ?? null,
      onOpen: activeRoom ? () => openInspector({ type: "conversation", id: activeRoom.id, label: activeRoom.name }) : undefined,
    },
    {
      type: "agent", label: "Agent", value: activeAgent?.name ?? null,
      onOpen: activeAgent ? () => openInspector({ type: "agent", id: activeAgent.id, label: activeAgent.name }) : undefined,
    },
    { type: "project", label: "Project", value: activeRoom?.projectId ?? null },
  ], [activeRoom, activeAgent, openInspector]);

  // Only capabilities that are actually wired are offered as actions; the rest
  // are shown as unavailable rather than as buttons that do nothing.
  const composerActions: ComposerAction[] = useMemo(() => [
    { id: "mention", label: "Mention another agent", icon: "context", onSelect: () => setInput(`${input}@`) },
    { id: "attach", label: "Attach file", icon: "attach", unavailableReason: "Attachments are not wired into this surface yet." },
    { id: "project", label: "Add project", icon: "project", unavailableReason: "Project selection moves here in a later phase." },
    { id: "workspace", label: "Add workspace", icon: "workspace", unavailableReason: "Workspace binding moves here in a later phase." },
    { id: "tool", label: "Use tool", icon: "tool", unavailableReason: "Tool invocation is available to agents, not yet from the composer." },
  ], [input, setInput]);

  const header = (
    <>
      <IconButton label="Conversations" onClick={() => setConversationDrawerOpen(true)}>
        <PanelLeft className="h-4 w-4" />
      </IconButton>
      <AgentSelector
        agents={agents}
        activeAgent={activeAgent}
        onSelect={(agentId) => {
          if (!selectedAgentIds.includes(agentId)) toggleSelectedAgent(agentId);
          else if (selectedAgentIds.length > 1) toggleSelectedAgent(agentId);
        }}
      />
      <ContextChip
        summary={activeRoom?.name ?? "No conversation"}
        entries={contextEntries}
      />
      <IconButton label="New chat" onClick={() => void handleCreateRoom()}><Plus className="h-4 w-4" /></IconButton>
      <div role="group" aria-label="Graph visibility" className="ml-1 hidden rounded-lg border border-[--border] bg-[--card] p-0.5 text-[12px] md:flex">
        {([["Graph live", false], ["Focus chat", true]] as const).map(([label, value]) => (
          <button
            key={label}
            type="button"
            aria-pressed={focusChat === value}
            onClick={() => setFocusChat(value)}
            className={cn("rounded-md px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]",
              focusChat === value ? "bg-[--accent] text-[--foreground]" : "text-[--muted-foreground] hover:text-[--foreground]")}
          >
            {label}
          </button>
        ))}
      </div>
    </>
  );

  return (
    <AppShell header={header}>
      <GlobeStage
        agents={globeAgents}
        followId={followId}
        onFollowChange={setFollowId}
        dimmed={focusChat}
        offsetX={focusChat ? 0 : 80}
      >
        <section
          data-orrery-ui
          aria-label="Conversation"
          className={cn(
            "absolute bottom-3.5 left-3.5 top-3.5 z-[3] flex flex-col overflow-hidden rounded-xl border border-[--glass-border] bg-[--glass] backdrop-blur-md",
            focusChat ? "right-3.5 mx-auto max-w-[52rem]" : "right-3.5 lg:right-auto lg:w-[min(468px,40%)]",
          )}
        >
          <ConversationDrawer
            rooms={rooms}
            activeRoomId={activeRoomId}
            onSelect={setActiveRoom}
            onCreate={() => void handleCreateRoom()}
          />

          <div className="flex items-center gap-2.5 border-b border-[--glass-border] px-3.5 py-3">
            <i className={cn("h-2 w-2 rounded-full", offline ? "bg-[--destructive]" : "bg-[--status-online] shadow-[0_0_8px_rgba(16,185,129,.6)]")} />
            <div className="min-w-0">
              <h2 className="truncate text-[14px] font-semibold">{activeRoom?.name ?? "No conversation"}</h2>
              <p className="truncate font-mono text-[11px] text-[--muted-foreground]">{activeAgent?.name ?? "Select an agent"}{activeAgent ? ` · ${activeAgent.model}` : ""}</p>
            </div>
          </div>

          {offline ? (
            <p className="px-4 py-2 text-center text-[13px] text-[--destructive]">
              Sentinel could not reach the conversation service. Messages cannot be sent right now.
            </p>
          ) : null}

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
            <div className="w-full space-y-5 px-3.5 py-4">
              {isHydrating ? (
                <p className="py-10 text-center text-[13px] text-[--muted-foreground]">Loading conversations…</p>
              ) : !activeRoom ? (
                <EmptyState
                  title="Start a conversation"
                  hint="Pick an agent above and send a message. Sentinel will load that agent's memory, workspace and tools with it."
                />
              ) : messages.length === 0 ? (
                <EmptyState
                  title={activeAgent ? `Message ${activeAgent.name}` : "Send your first message"}
                  hint={roomAgents.length > 1 ? "Mention an agent with @ to direct a message to them." : undefined}
                />
              ) : (
                messages.map((message) => (
                  <ConversationMessage
                    key={message.id}
                    message={message}
                    agentName={message.agentId ? agentNameById.get(message.agentId) : undefined}
                    streaming={message.isStreaming}
                  />
                ))
              )}
              {isThinking && !isStreaming ? (
                <p className="text-[13px] text-[--muted-foreground]">{activeAgent?.name ?? "Agent"} is thinking…</p>
              ) : null}
              <div ref={bottomRef} />
            </div>
          </div>

          <Composer
            value={input}
            onChange={setInput}
            onSend={() => void handleSend()}
            disabled={offline || !activeRoom}
            busy={busy}
            placeholder={activeAgent ? `Message ${activeAgent.name}, or @agent…` : "Message an agent…"}
            actions={composerActions}
          />
        </section>

        {focusChat ? null : (
          <ActivityPanel agents={panelAgents} events={feed} followId={followId} onFollow={setFollowId} />
        )}
      </GlobeStage>
    </AppShell>
  );
}
