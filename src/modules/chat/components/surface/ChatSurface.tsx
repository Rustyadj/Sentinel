"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Activity as ActivityIcon, PanelLeft, Plus, Users } from "lucide-react";
import { useChatSession } from "@/lib/chat/useChatSession";
import { useMe } from "@/lib/people/useMe";
import { useShellStore } from "@/store/useShellStore";
import { AppShell } from "@/components/shell/AppShell";
import { AgentSelector } from "@/components/shell/AgentSelector";
import { ContextChip, type ContextEntry } from "@/components/shell/ContextChip";
import { ConversationDrawer } from "@/components/shell/ConversationDrawer";
import { EmptyState, IconButton } from "@/components/shell/primitives";
import { WatchStage } from "@/components/watch/WatchStage";
import { useWatch } from "@/components/watch/useWatch";
import { ActivityPanel } from "@/components/orrery/ActivityPanel";
import { AttentionCards } from "@/components/orrery/AttentionCards";
import { ModelPicker } from "@/components/orrery/ModelPicker";
import { OrreryStatusStrip, orreryNotices } from "@/components/orrery/OrreryStatusStrip";
import { cn } from "@/lib/utils";
import { ConversationMessage } from "./ConversationMessage";
import { Composer, type ComposerAction } from "./Composer";

/**
 * Sentinel's default surface: the conversation on the left, and beside it
 * the watch, where each agent's light shows what it is doing and its beam
 * falls on what it is touching. Both are solid panes; nothing is layered
 * over the graph.
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
  // In a shared room a message can go to the agent or just to the people in it.
  const [audience, setAudience] = useState<"agent" | "people">("agent");
  const me = useMe();

  const {
    rooms, activeRoom, activeRoomId, agents, roomAgents, activeAgent, selectedAgentIds,
    toggleSelectedAgent, input, setInput, isThinking, isStreaming, isHydrating, offline,
    setActiveRoom, handleSend, handleSendNote, handleCreateRoom,
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

  const { orrery, handleRef, activityState, stageAgents, panelAgents, graphMessage } = useWatch(
    agents,
    { workingAgentId, detail: isStreaming ? "Writing a reply" : "Thinking" },
  );

  // What the conversation is about, in graph terms: the agents in this room,
  // and the room and its project if the graph holds them. What those agents
  // touch is already shown by their beams. Ids the graph does not hold are
  // simply ignored by the renderer; nothing is drawn on their behalf.
  const focusIds = useMemo(() => {
    const ids = new Set<string>();
    const inRoom = new Set([...(roomAgents ?? []).map((a) => a.id), ...(activeAgent ? [activeAgent.id] : [])]);
    for (const agentId of inRoom) {
      const nodeId = activityState.get(agentId)?.nodeId;
      if (nodeId) ids.add(nodeId);
    }
    if (activeRoom?.id) ids.add(activeRoom.id);
    if (activeRoom?.projectId) ids.add(activeRoom.projectId);
    return [...ids];
  }, [roomAgents, activeAgent, activityState, activeRoom]);

  const notices = useMemo(
    () => orreryNotices({ ready: orrery.status === "ready", graph: orrery.graphHealth, activity: orrery.activityHealth, partial: orrery.partial, activityTruncated: orrery.activityTruncated }),
    [orrery.status, orrery.graphHealth, orrery.activityHealth, orrery.partial, orrery.activityTruncated],
  );

  // Someone who cannot run agents can still talk to the people in a room.
  const inProject = Boolean(activeRoom?.projectId);
  const canAsk = me ? me.canRunAgents : true;
  const toPeople = !canAsk || (inProject && audience === "people");
  const send = () => void (toPeople ? handleSendNote() : handleSend());

  const contextEntries: ContextEntry[] = useMemo(() => [
    {
      type: "conversation", label: "Conversation", value: activeRoom?.name ?? null,
      onOpen: activeRoom ? () => openInspector({ type: "conversation", id: activeRoom.id, label: activeRoom.name }) : undefined,
    },
    {
      type: "agent", label: "Agent", value: activeAgent?.name ?? null,
      onOpen: activeAgent ? () => openInspector({ type: "agent", id: activeAgent.id, label: activeAgent.name }) : undefined,
    },
    { type: "project", label: "Project", value: activeRoom?.projectName ?? activeRoom?.projectId ?? null },
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
        <div role="group" aria-label="Layout" className="hidden rounded-full border border-(--border) bg-(--panel) p-0.5 text-[12px] lg:flex">
          {([["Split", false], ["Focus", true]] as const).map(([label, value]) => (
            <button
              key={label}
              type="button"
              aria-pressed={focusChat === value}
              title={value ? "Hide the graph and centre the conversation" : "Show the graph beside the conversation"}
              onClick={() => setFocusChat(value)}
              className={cn("rounded-full px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                focusChat === value ? "bg-(--accent) text-(--foreground)" : "text-(--muted-foreground) hover:text-(--foreground)")}
            >
              {label}
            </button>
          ))}
        </div>
        <IconButton
          label={showActivity ? "Hide agent activity" : "Show agent activity"}
          active={showActivity}
          className="hidden xl:inline-flex"
          onClick={() => { setFocusChat(false); setActivityOpen(!showActivity); }}
        >
          <ActivityIcon className="h-4 w-4" />
        </IconButton>
      </div>
    </>
  );

  return (
    <AppShell header={header}>
      <div className="flex h-full w-full flex-col lg:flex-row">
        <section
          aria-label="Conversation"
          className={cn(
            "relative order-2 flex min-h-0 flex-1 flex-col overflow-hidden bg-(--background) lg:order-1",
            focusChat ? "lg:mx-auto lg:max-w-[820px]" : "lg:w-[min(560px,42%)] lg:flex-none lg:border-r lg:border-(--border)",
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
              className={cn("h-2.5 w-2.5 shrink-0 rounded-full", offline ? "bg-(--destructive)" : busy ? "bg-(--status-busy)" : "bg-(--status-online)")}
            />
            <div className="min-w-0">
              <h2 className="truncate font-display text-[18px] font-semibold leading-tight tracking-tight">{activeRoom?.name ?? "No conversation"}</h2>
              <p className="flex items-center gap-1.5 truncate text-[12.5px] text-(--muted-foreground)">
                <span className="sr-only">Status: {offline ? "offline" : busy ? "working" : "online"}. </span>
                {inProject ? (
                  <span className="inline-flex shrink-0 items-center gap-1 text-(--entity-project)">
                    <Users aria-hidden className="h-3 w-3" />
                    {activeRoom?.projectName ?? "Project room"}
                  </span>
                ) : null}
                <span className="truncate">
                  {activeAgent ? `with ${activeAgent.name}` : "Select an agent"}
                  {roomAgents.length > 1 ? ` and ${roomAgents.length - 1} more` : ""}
                </span>
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
            <p role="alert" className="border-b border-(--border) bg-[color-mix(in_srgb,var(--destructive)_10%,transparent)] px-4 py-2 text-[13px] text-(--destructive)">
              Sentinel could not reach the conversation service. Messages cannot be sent right now.
            </p>
          ) : null}

          <div ref={scrollRef} className="min-h-0 flex-1 overflow-y-auto" aria-live="polite" aria-busy={busy}>
            <div className="mx-auto w-full max-w-[44rem] space-y-6 px-4 py-5">
              {isHydrating ? (
                <div className="space-y-4 py-4" aria-label="Loading conversations">
                  {[72, 54, 64].map((w) => (
                    <div key={w} className="h-3 animate-pulse rounded-full bg-(--muted) motion-reduce:animate-none" style={{ width: `${w}%` }} />
                  ))}
                </div>
              ) : !activeRoom ? (
                me?.guest ? (
                  <EmptyState
                    title="No rooms yet"
                    hint="Rooms from the projects you were invited to appear here as soon as someone opens one."
                  />
                ) : (
                  <EmptyState
                    title="Start a conversation"
                    hint="Pick an agent in the top bar and send a message. Sentinel brings that agent's memory, workspace and tools with it."
                    action={<button type="button" onClick={() => void handleCreateRoom()} className="mt-2 rounded-full bg-(--primary) px-4 py-1.5 text-[13px] font-semibold text-(--primary-foreground) hover:bg-(--primary-soft) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring) focus-visible:ring-offset-2 focus-visible:ring-offset-(--background)">New chat</button>}
                  />
                )
              ) : messages.length === 0 ? (
                <EmptyState
                  title={toPeople ? "Say something to the room" : activeAgent ? `Message ${activeAgent.name}` : "Send your first message"}
                  hint={toPeople
                    ? "Everyone on this project sees what you write here."
                    : roomAgents.length > 1 ? "Mention an agent with @ to direct a message to them." : "What the agent touches lights up in the graph."}
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
                  <span aria-hidden className="animate-pulse-dot h-2 w-2 rounded-full" style={{ background: activeAgent?.color ?? "var(--primary)" }} />
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

          {inProject && canAsk ? (
            <div role="group" aria-label="Who this message is for" className="mx-3 mb-2 flex w-fit rounded-full border border-(--border) bg-(--panel) p-0.5 text-[12px]">
              {([["agent", activeAgent ? `Ask ${activeAgent.name}` : "Ask an agent"], ["people", "Tell the room"]] as const).map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  aria-pressed={audience === value}
                  onClick={() => setAudience(value)}
                  className={cn("rounded-full px-3 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                    audience === value ? "bg-(--accent) text-(--foreground)" : "text-(--muted-foreground) hover:text-(--foreground)")}
                >
                  {label}
                </button>
              ))}
            </div>
          ) : null}

          <Composer
            value={input}
            onChange={setInput}
            onSend={send}
            disabled={offline || !activeRoom}
            busy={busy}
            placeholder={toPeople ? "Write to the people in this room…" : activeAgent ? `Message ${activeAgent.name}, or @agent…` : "Message an agent…"}
            actions={composerActions}
          />
          {me && !me.canRunAgents && activeRoom ? (
            <p className="-mt-1 px-4 pb-3 text-[12px] text-(--text-faint)">Your role does not run agents, so messages go to the people in the room.</p>
          ) : null}
        </section>

        {focusChat ? null : (
          <div className="order-1 flex h-[210px] shrink-0 border-b border-(--border) lg:order-2 lg:h-auto lg:min-w-0 lg:flex-1 lg:border-b-0">
            <div className="relative min-w-0 flex-1">
              <WatchStage
                model={orrery.model}
                message={graphMessage}
                handleRef={handleRef}
                agents={stageAgents}
                focusIds={focusIds}
                followId={followId}
                onFollowChange={setFollowId}
                className="[&_[data-watch-ui]]:max-lg:hidden"
              >
                <OrreryStatusStrip notices={notices} onRetry={orrery.retry} />
              </WatchStage>
            </div>
            {showActivity ? (
              <ActivityPanel agents={panelAgents} events={orrery.feed} followId={followId} onFollow={setFollowId} roomId={activeRoomId ?? undefined} onTranscript={setInput} />
            ) : null}
          </div>
        )}
      </div>
    </AppShell>
  );
}
