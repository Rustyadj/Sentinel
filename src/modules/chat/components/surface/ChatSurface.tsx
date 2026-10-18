"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity as ActivityIcon, PanelLeft, Plus } from "lucide-react";
import { useChatSession } from "@/lib/chat/useChatSession";
import { useShellStore } from "@/store/useShellStore";
import { AppShell } from "@/components/shell/AppShell";
import { AgentSelector } from "@/components/shell/AgentSelector";
import { ContextChip, type ContextEntry } from "@/components/shell/ContextChip";
import { ConversationDrawer } from "@/components/shell/ConversationDrawer";
import { EmptyState, IconButton } from "@/components/shell/primitives";
import { StrataStage, type StrataHandle } from "@/components/strata/StrataStage";
import type { StrataInsets } from "@/components/strata/strata-renderer";
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

const NO_INSETS: StrataInsets = { left: 0, right: 0, top: 0, bottom: 0 };
const BAND_HEIGHT = 168;

/** Measures the foreground panels so the strata centre in the space they leave. */
function useStageInsets(centred: boolean, deps: unknown[]) {
  const stageRef = useRef<HTMLDivElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const [insets, setInsets] = useState<StrataInsets>(NO_INSETS);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const host = stage.getBoundingClientRect();
      const panel = panelRef.current?.getBoundingClientRect();
      const aside = stage.querySelector<HTMLElement>("[data-activity-panel]")?.getBoundingClientRect();
      const wide = host.width >= 1024;
      const next: StrataInsets = wide && centred
        ? { left: 0, right: 0, top: 16, bottom: 16 }
        : wide
        ? {
          // The strata start under the conversation's right edge, so the panel
          // reads as standing in front of them rather than beside them.
          left: panel && panel.width < host.width * 0.7 ? Math.max(0, panel.right - host.left - Math.min(240, panel.width * 0.45)) : 0,
          right: aside && aside.width > 0 ? host.right - aside.left + 8 : 0,
          top: 16,
          bottom: 16,
        }
        // Narrow: the strata are a band above the conversation.
        : { left: 0, right: 0, top: 6, bottom: Math.max(0, host.height - BAND_HEIGHT) };
      setInsets((prev) => (
        prev.left === next.left && prev.right === next.right && prev.top === next.top && prev.bottom === next.bottom ? prev : next
      ));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(stage);
    if (panelRef.current) ro.observe(panelRef.current);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  return { stageRef, panelRef, insets };
}

/**
 * Sentinel's default surface. The conversation stands in front; behind it
 * the knowledge graph is laid out as strata — agents, projects, tasks,
 * memory — and the parts the conversation touches light up. Agent, context
 * and history are one click away in the top bar.
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
  const [activityOpen, setActivityOpen] = useState<boolean | null>(null);
  const strataRef = useRef<StrataHandle>(null);
  const handleOrreryEvents = useCallback((events: OrreryEvent[]) => {
    for (const e of events) strataRef.current?.dispatch(e.agentId, e.nodeIds);
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

  // Activity starts open where there is room for it, closed elsewhere; after
  // that it is the operator's choice.
  useEffect(() => {
    if (activityOpen !== null) return;
    const id = requestAnimationFrame(() => setActivityOpen(window.matchMedia("(min-width: 1280px)").matches));
    return () => cancelAnimationFrame(id);
  }, [activityOpen]);
  const showActivity = Boolean(activityOpen) && !focusChat;
  const { stageRef, panelRef, insets } = useStageInsets(focusChat, [showActivity, focusChat]);

  const messages = useMemo(() => activeRoom?.messages ?? [], [activeRoom]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: messages.length > 1 ? "smooth" : "auto", block: "end" });
  }, [messages.length, isStreaming]);

  const agentNameById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.name])),
    [agents],
  );
  const agentColorById = useMemo(
    () => new Map(agents.map((agent) => [agent.id, agent.color])),
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

  // What the conversation is about, in graph terms: the agents in this room,
  // the room and its project if the graph holds them, and whatever those
  // agents have touched most recently. Ids the graph does not hold are simply
  // ignored by the renderer — nothing is drawn on their behalf.
  const focusIds = useMemo(() => {
    const ids = new Set<string>();
    const inRoom = new Set([...(roomAgents ?? []).map((a) => a.id), ...(activeAgent ? [activeAgent.id] : [])]);
    for (const agentId of inRoom) {
      const nodeId = activityState.get(agentId)?.nodeId;
      if (nodeId) ids.add(nodeId);
    }
    if (activeRoom?.id) ids.add(activeRoom.id);
    if (activeRoom?.projectId) ids.add(activeRoom.projectId);
    let recent = 0;
    for (const e of orrery.feed) {
      if (!inRoom.has(e.agentId)) continue;
      for (const id of e.nodeIds) ids.add(id);
      if (++recent >= 6) break;
    }
    return [...ids];
  }, [roomAgents, activeAgent, activityState, activeRoom, orrery.feed]);

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

  const graphMessage = orrery.status === "error"
    ? orrery.error
    : orrery.status === "ready" && (orrery.model?.nodeCount ?? 0) === 0
      ? "The graph is empty. Agents, projects, tasks and memories appear on their layer as Sentinel records them."
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
      <div className="ml-auto flex items-center gap-1 lg:ml-2">
        <div role="group" aria-label="Graph visibility" className="hidden rounded-md border border-(--border) bg-(--panel) p-0.5 text-[12px] md:flex">
          {([["Graph", false], ["Focus", true]] as const).map(([label, value]) => (
            <button
              key={label}
              type="button"
              aria-pressed={focusChat === value}
              title={value ? "Quiet the graph and centre the conversation" : "Show the graph behind the conversation"}
              onClick={() => setFocusChat(value)}
              className={cn("rounded px-2.5 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                focusChat === value ? "bg-(--accent) text-(--foreground)" : "text-(--muted-foreground) hover:text-(--foreground)")}
            >
              {label}
            </button>
          ))}
        </div>
        <IconButton
          label={showActivity ? "Hide agent activity" : "Show agent activity"}
          active={showActivity}
          className="hidden lg:inline-flex"
          onClick={() => { setFocusChat(false); setActivityOpen(!showActivity); }}
        >
          <ActivityIcon className="h-4 w-4" />
        </IconButton>
      </div>
    </>
  );

  return (
    <AppShell header={header}>
      <div ref={stageRef} className="relative h-full w-full">
        <StrataStage
          model={orrery.model}
          message={graphMessage}
          handleRef={strataRef}
          agents={globeAgents}
          focusIds={focusIds}
          followId={followId}
          onFollowChange={setFollowId}
          dimmed={focusChat}
          insets={insets}
          className="[&_[data-strata-ui]]:max-lg:hidden"
        >
          <OrreryStatusStrip notices={notices} onRetry={orrery.retry} />
          <section
            ref={panelRef}
            aria-label="Conversation"
            className={cn(
              "absolute inset-x-0 bottom-0 z-[3] flex flex-col overflow-hidden border-t border-(--glass-border) bg-[rgba(14,20,22,0.8)] shadow-[var(--shadow-lg)] backdrop-blur-[6px]",
              "top-[168px] lg:top-4 lg:bottom-4 lg:rounded-lg lg:border",
              focusChat ? "lg:left-1/2 lg:right-auto lg:w-[min(760px,calc(100%-2rem))] lg:-translate-x-1/2" : "lg:left-4 lg:right-auto lg:w-[min(540px,44%)]",
            )}
          >
            <ConversationDrawer
              rooms={rooms}
              activeRoomId={activeRoomId}
              onSelect={setActiveRoom}
              onCreate={() => void handleCreateRoom()}
            />

            <div className="flex items-center gap-3 border-b border-(--border) px-4 py-3">
              <span
                aria-hidden
                className={cn("h-2 w-2 shrink-0 rounded-full", offline ? "bg-(--destructive)" : busy ? "bg-(--status-busy)" : "bg-(--status-online)")}
              />
              <div className="min-w-0">
                <h2 className="truncate font-display text-[16px] font-semibold leading-tight tracking-tight">{activeRoom?.name ?? "No conversation"}</h2>
                <p className="truncate text-[12px] text-(--muted-foreground)">
                  <span className="sr-only">Status: {offline ? "offline" : busy ? "working" : "online"}. </span>
                  {activeAgent ? `with ${activeAgent.name}` : "Select an agent"}
                  {roomAgents.length > 1 ? ` and ${roomAgents.length - 1} more` : ""}
                </p>
              </div>
              <div className="ml-auto">
                <ModelPicker
                  agents={agents.map((a) => ({ id: a.id, name: a.name, color: a.color, model: a.model }))}
                  activeAgentId={activeAgent?.id}
                />
              </div>
            </div>

            {offline ? (
              <p role="alert" className="border-b border-(--border) bg-[rgba(239,107,94,0.08)] px-4 py-2 text-[13px] text-(--destructive)">
                Sentinel could not reach the conversation service. Messages cannot be sent right now.
              </p>
            ) : null}

            <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={busy}>
              <div className="mx-auto w-full max-w-[44rem] space-y-6 px-4 py-5">
                {isHydrating ? (
                  <div className="space-y-4 py-4" aria-label="Loading conversations">
                    {[72, 54, 64].map((w) => (
                      <div key={w} className="h-3 animate-pulse rounded bg-(--muted) motion-reduce:animate-none" style={{ width: `${w}%` }} />
                    ))}
                  </div>
                ) : !activeRoom ? (
                  <EmptyState
                    title="Start a conversation"
                    hint="Pick an agent in the top bar and send a message. Sentinel brings that agent's memory, workspace and tools with it."
                    action={<button type="button" onClick={() => void handleCreateRoom()} className="mt-2 rounded-md bg-(--primary) px-3 py-1.5 text-[13px] font-medium text-(--primary-foreground) hover:bg-(--primary-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--background)">New chat</button>}
                  />
                ) : messages.length === 0 ? (
                  <EmptyState
                    title={activeAgent ? `Message ${activeAgent.name}` : "Send your first message"}
                    hint={roomAgents.length > 1 ? "Mention an agent with @ to direct a message to them." : "What the conversation touches lights up in the graph behind it."}
                  />
                ) : (
                  messages.map((message) => (
                    <ConversationMessage
                      key={message.id}
                      message={message}
                      agentName={message.agentId ? agentNameById.get(message.agentId) : undefined}
                      agentColor={message.agentId ? agentColorById.get(message.agentId) : undefined}
                      streaming={message.isStreaming}
                    />
                  ))
                )}
                {isThinking && !isStreaming ? (
                  <p className="flex items-center gap-2 text-[13px] text-(--muted-foreground)">
                    <span aria-hidden className="animate-pulse-dot h-1.5 w-1.5 rounded-full bg-(--primary)" />
                    {activeAgent?.name ?? "Agent"} is thinking…
                  </p>
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

          {showActivity ? (
            <ActivityPanel agents={panelAgents} events={orrery.feed} followId={followId} onFollow={setFollowId} roomId={activeRoomId ?? undefined} onTranscript={setInput} />
          ) : null}
        </StrataStage>
      </div>
    </AppShell>
  );
}
