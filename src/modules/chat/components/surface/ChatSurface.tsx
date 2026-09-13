"use client";

import { useEffect, useMemo, useRef } from "react";
import { useSearchParams } from "next/navigation";
import { PanelLeft, Plus } from "lucide-react";
import { useChatSession } from "@/lib/chat/useChatSession";
import { useShellStore } from "@/store/useShellStore";
import { AppShell } from "@/components/shell/AppShell";
import { AgentSelector } from "@/components/shell/AgentSelector";
import { ContextChip, type ContextEntry } from "@/components/shell/ContextChip";
import { ConversationDrawer } from "@/components/shell/ConversationDrawer";
import { EmptyState, IconButton } from "@/components/shell/primitives";
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
    </>
  );

  return (
    <AppShell header={header}>
      <div className="relative flex h-full flex-col">
        <ConversationDrawer
          rooms={rooms}
          activeRoomId={activeRoomId}
          onSelect={setActiveRoom}
          onCreate={() => void handleCreateRoom()}
        />

        {offline ? (
          <p className="px-4 py-2 text-center text-[13px] text-[--destructive]">
            Sentinel could not reach the conversation service. Messages cannot be sent right now.
          </p>
        ) : null}

        <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-[52rem] space-y-6 px-4 py-8">
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
          busy={isThinking || isStreaming}
          placeholder={activeAgent ? `Message ${activeAgent.name}…` : "Message an agent…"}
          actions={composerActions}
        />
      </div>
    </AppShell>
  );
}
