"use client";

import { useEffect, useState } from "react";
import { Check, ChevronDown, Maximize2, MessageSquare, PanelLeftClose, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { useGraphStore } from "@/store/useGraphStore";
import type { ChatSession } from "@/lib/chat/useChatSession";

interface ChatHeaderProps {
  activeRoom: ChatSession["activeRoom"];
  activeRoomId: ChatSession["activeRoomId"];
  rooms: ChatSession["rooms"];
  roomAgents: ChatSession["roomAgents"];
  selectedAgents: ChatSession["selectedAgents"];
  selectedAgentIds: ChatSession["selectedAgentIds"];
  toggleSelectedAgent: ChatSession["toggleSelectedAgent"];
  activeAgent: ChatSession["activeAgent"];
  live: boolean;
  offline: boolean;
  setActiveRoom: ChatSession["setActiveRoom"];
  handleCreateRoom: ChatSession["handleCreateRoom"];
  onToggleCollapsed: () => void;
  /** Collapse the chat panel AND close RightPanel for a true fullscreen graph. */
  onExpandGraph: () => void;
}

/**
 * Chat panel header: multi-select agent picker + status, room switcher, and
 * the fullscreen-graph trigger. Split out of ChatPanel so it can be reasoned
 * about (and tested) independently of the thread/composer.
 */
export function ChatHeader({
  activeRoom,
  activeRoomId,
  rooms,
  roomAgents,
  selectedAgents,
  selectedAgentIds,
  toggleSelectedAgent,
  activeAgent,
  live,
  offline,
  setActiveRoom,
  handleCreateRoom,
  onToggleCollapsed,
  onExpandGraph,
}: ChatHeaderProps) {
  const [roomsOpen, setRoomsOpen] = useState(false);
  const [agentsOpen, setAgentsOpen] = useState(false);
  const requestFocus = useGraphStore((state) => state.requestFocus);
  const setPinnedTitles = useGraphStore((state) => state.setPinnedTitles);

  // Every selected agent's node stays lit for as long as it's selected —
  // kept in sync with the graph store here so ChatPanel/useChatSession don't
  // need to know the graph exists at all.
  useEffect(() => {
    setPinnedTitles(selectedAgents.map((a) => a.name));
  }, [selectedAgents, setPinnedTitles]);

  function handleToggle(agentId: string, agentName: string) {
    const wasSelected = selectedAgentIds.includes(agentId);
    toggleSelectedAgent(agentId);
    // Rotate the graph to center newly-added agents and light them up — same
    // camera-focus + neighborhood-glow a click on the node itself produces.
    // (Removing a selection just lets its pinned glow drop away; no camera move.)
    if (!wasSelected) requestFocus(agentName);
  }

  const primaryLabel =
    selectedAgents.length === 0
      ? "No agent selected"
      : selectedAgents.length === 1
        ? selectedAgents[0].name
        : `${activeAgent?.name ?? selectedAgents[0].name} +${selectedAgents.length - 1}`;

  return (
    <header className="flex h-14 shrink-0 items-center gap-2.5 border-b border-[#182638] px-3.5">
      {/* Agent picker (multi-select) */}
      <div className="relative shrink-0">
        <button
          type="button"
          onClick={() => setAgentsOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={agentsOpen}
          aria-label="Select agents"
          className="flex items-center gap-2 rounded-lg py-1 pl-1 pr-2 outline-none transition-colors hover:bg-white/[0.04] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        >
          <span className="relative shrink-0 flex items-center">
            {selectedAgents.slice(0, 3).map((agent, i) => (
              <span
                key={agent.id}
                className="flex h-8 w-8 items-center justify-center rounded-full border border-sky-300/20 bg-cover bg-top text-[13px] text-transparent"
                style={{
                  backgroundImage: agent.id === "hermes-lisa" ? "url('/media/hermes-lisa.png')" : undefined,
                  marginLeft: i === 0 ? 0 : -12,
                  zIndex: 3 - i,
                }}
                aria-hidden
              >
                {agent.avatar}
              </span>
            ))}
            {selectedAgents.length === 0 && (
              <span className="flex h-8 w-8 items-center justify-center rounded-full border border-dashed border-white/15 text-[13px] text-[#4a5065]" aria-hidden>
                +
              </span>
            )}
            <span
              aria-hidden
              className={cn(
                "absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full border-2 border-[#07111d]",
                live ? "animate-pulse-dot bg-amber-400" : "bg-emerald-400"
              )}
            />
          </span>
          <span className="min-w-0 text-left">
            <span className="flex items-center gap-1">
              <span className="truncate text-[12.5px] font-medium leading-tight text-[#e8eaed]">
                {primaryLabel}
              </span>
              <ChevronDown className="h-3 w-3 shrink-0 text-[#4a5065]" />
            </span>
            <span className="block text-[10px] leading-tight text-[#697084]">
              {offline ? (
                <span className="text-red-400">Offline — reconnect to send</span>
              ) : live ? (
                <span className="text-amber-400">Responding…</span>
              ) : (
                "Online"
              )}
            </span>
          </span>
        </button>
        {agentsOpen && (
          <>
            {/* Backdrop — multi-select stays open on each toggle, so closing needs an explicit outside click. */}
            <button
              type="button"
              aria-label="Close agent picker"
              className="fixed inset-0 z-40 cursor-default"
              onClick={() => setAgentsOpen(false)}
            />
            <ul
              role="listbox"
              aria-label="Agents in this room"
              aria-multiselectable="true"
              className="absolute left-0 top-full z-50 mt-1 max-h-64 w-56 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#10141d]/95 py-1 shadow-2xl backdrop-blur-xl"
            >
              {roomAgents.map((agent) => {
                const checked = selectedAgentIds.includes(agent.id);
                return (
                  <li key={agent.id} role="option" aria-selected={checked}>
                    <button
                      type="button"
                      onClick={() => handleToggle(agent.id, agent.name)}
                      className={cn(
                        "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] transition-colors hover:bg-white/[0.05]",
                        checked ? "text-indigo-300" : "text-[#c8cdd8]"
                      )}
                    >
                      <span
                        aria-hidden
                        className={cn(
                          "flex h-3.5 w-3.5 shrink-0 items-center justify-center rounded border",
                          checked ? "border-indigo-400 bg-indigo-500/80" : "border-white/20"
                        )}
                      >
                        {checked && <Check className="h-2.5 w-2.5 text-white" />}
                      </span>
                      <span aria-hidden className="text-sm">{agent.avatar}</span>
                      <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        )}
      </div>
      <div className="min-w-0 flex-1" />

      {/* Room switcher */}
      <div className="relative">
        <button
          type="button"
          onClick={() => setRoomsOpen((v) => !v)}
          aria-haspopup="listbox"
          aria-expanded={roomsOpen}
          aria-label="Switch room"
          className="flex max-w-[120px] items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-2 py-1 text-[10.5px] text-[#9aa1b4] outline-none transition-colors hover:border-white/[0.14] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        >
          <span className="truncate">{activeRoom?.name ?? "No room"}</span>
          <ChevronDown className="h-3 w-3 shrink-0 text-[#4a5065]" />
        </button>
        {roomsOpen && (
          <ul
            role="listbox"
            aria-label="Rooms"
            className="absolute right-0 top-full z-50 mt-1 max-h-56 w-48 overflow-y-auto rounded-lg border border-white/[0.08] bg-[#10141d]/95 py-1 shadow-2xl backdrop-blur-xl"
          >
            {rooms.map((room) => (
              <li key={room.id} role="option" aria-selected={room.id === activeRoomId}>
                <button
                  type="button"
                  onClick={() => {
                    setActiveRoom(room.id);
                    setRoomsOpen(false);
                  }}
                  className={cn(
                    "flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] transition-colors hover:bg-white/[0.05]",
                    room.id === activeRoomId ? "text-indigo-300" : "text-[#c8cdd8]"
                  )}
                >
                  <MessageSquare className="h-3 w-3 shrink-0 opacity-60" />
                  <span className="truncate">{room.name}</span>
                </button>
              </li>
            ))}
            <li className="mt-1 border-t border-white/[0.06] pt-1">
              <button
                type="button"
                onClick={() => {
                  setRoomsOpen(false);
                  void handleCreateRoom();
                }}
                className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-[#697084] transition-colors hover:bg-white/[0.05] hover:text-[#c8cdd8]"
              >
                <Plus className="h-3 w-3" />
                New room
              </button>
            </li>
          </ul>
        )}
      </div>

      <button
        type="button"
        onClick={onExpandGraph}
        aria-label="Expand graph to fullscreen"
        title="Expand graph to fullscreen"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#697084] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
      >
        <Maximize2 className="h-3.5 w-3.5" />
      </button>

      <button
        type="button"
        onClick={onToggleCollapsed}
        aria-label="Collapse chat panel"
        className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-[#697084] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
      >
        <PanelLeftClose className="h-3.5 w-3.5" />
      </button>
    </header>
  );
}
