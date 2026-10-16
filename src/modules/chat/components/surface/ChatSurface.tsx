"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { PanelLeft, Plus } from "lucide-react";
import { useChatSession } from "@/lib/chat/useChatSession";
import { useShellStore } from "@/store/useShellStore";
import { AppShell } from "@/components/shell/AppShell";
import { AgentSelector } from "@/components/shell/AgentSelector";
import { ContextChip, type ContextEntry } from "@/components/shell/ContextChip";
import { ConversationDrawer } from "@/components/shell/ConversationDrawer";
import { EmptyState, IconButton } from "@/components/shell/primitives";
import { GlobeStage, type GlobeHandle } from "@/components/orrery/GlobeStage";
import { ActivityPanel, type PanelAgent } from "@/components/orrery/ActivityPanel";
import { AttentionCards } from "@/components/orrery/AttentionCards";
import { ModelPicker } from "@/components/orrery/ModelPicker";
import { useOrreryData } from "@/components/orrery/useOrreryData";
import { OrreryStatusStrip, orreryNotices } from "@/components/orrery/OrreryStatusStrip";
import { CANONICAL_VOICE_AGENT_IDS } from "@/lib/voice/agent-voice-config";
import type { OrreryEvent } from "@/lib/orrery/types";
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
  const globeRef = useRef<GlobeHandle>(null);
  const handleOrreryEvents = useCallback((events: OrreryEvent[]) => {
    for (const e of events) globeRef.current?.dispatch(e.agentId, e.nodeIds);
  }, []);
  const orrery = useOrreryData(handleOrreryEvents);

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

  const activityState = useMemo(() => new Map((orrery.activity?.agents ?? []).map((x) => [x.agentId, x])), [orrery.activity]);
  const latestByAgent = useMemo(() => {
    const map = new Map<string, OrreryEvent>();
    for (const e of orrery.feed) if (!map.has(e.agentId)) map.set(e.agentId, e);
    return map;
  }, [orrery.feed]);

  // Working = a live session/run on the server, or this chat is awaiting a reply.
  const isWorking = useCallback(
    (agentId: string) => agentId === workingAgentId || activityState.get(agentId)?.state === "working",
    [workingAgentId, activityState],
  );

  const globeAgents = useMemo(
    () => agents.map((a) => ({ id: a.id, name: a.name, color: a.color, working: isWorking(a.id), nodeId: activityState.get(a.id)?.nodeId ?? null })),
    [agents, isWorking, activityState],
  );

  const panelAgents: PanelAgent[] = useMemo(() => agents.map((a) => {
    const working = isWorking(a.id);
    const latest = latestByAgent.get(a.id);
    return {
      id: a.id, name: a.name, color: a.color, model: a.model,
      state: working ? "working" : a.status === "offline" ? "offline" : "idle",
      detail: working ? (a.id === workingAgentId ? (isStreaming ? "Writing a reply" : "Thinking") : latest?.text ?? "Working") : a.role,
      voice: (CANONICAL_VOICE_AGENT_IDS as readonly string[]).includes(a.id),
    };
  }), [agents, isWorking, latestByAgent, workingAgentId, isStreaming]);

  const notices = useMemo(
    () => orreryNotices({ ready: orrery.status === "ready", graph: orrery.graphHealth, activity: orrery.activityHealth, partial: orrery.partial, activityTruncated: orrery.activityTruncated }),
    [orrery.status, orrery.graphHealth, orrery.activityHealth, orrery.partial, orrery.activityTruncated],
  );

  const globeMessage = orrery.status === "error"
    ? orrery.error
    : orrery.status === "ready" && (orrery.model?.nodeCount ?? 0) === 0
      ? "Your graph is empty. Objects appear here as conversations, tasks and agents create them."
      : null;

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
        model={orrery.model}
        emptyMessage={globeMessage}
        handleRef={globeRef}
        agents={globeAgents}
        followId={followId}
        onFollowChange={setFollowId}
        dimmed={focusChat}
        offsetX={focusChat ? 0 : 80}
      >
        <OrreryStatusStrip notices={notices} onRetry={orrery.retry} />
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
              <p className="truncate font-mono text-[11px] text-[--muted-foreground]">{activeAgent?.name ?? "Select an agent"}</p>
            </div>
            <div className="ml-auto">
              <ModelPicker
                agents={agents.map((a) => ({ id: a.id, name: a.name, color: a.color, model: a.model }))}
                activeAgentId={activeAgent?.id}
              />
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

          <AttentionCards
            runs={orrery.activity?.runs ?? []}
            approvals={orrery.activity?.approvals ?? []}
            agents={agents.map((a) => ({ id: a.id, name: a.name, color: a.color }))}
            followId={followId}
            onFollow={setFollowId}
            onDecided={orrery.refresh}
          />

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
          <ActivityPanel agents={panelAgents} events={orrery.feed} followId={followId} onFollow={setFollowId} roomId={activeRoomId ?? undefined} onTranscript={setInput} />
        )}
      </GlobeStage>
    </AppShell>
  );
}
