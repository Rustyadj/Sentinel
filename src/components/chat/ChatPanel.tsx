"use client";

import { useEffect, useRef, useState } from "react";
import {
  AtSign,
  Check,
  Globe,
  Loader2,
  MessageSquare,
  PanelLeftOpen,
  Paperclip,
  Send,
  X,
} from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { ChatHeader } from "./ChatHeader";
import { MessageThread } from "./MessageThread";
import { VoiceControls } from "@/components/voice/VoiceControls";
import type { ChatSession } from "@/lib/chat/useChatSession";
import type { VoiceStatus } from "@/lib/voice/types";
import type { ExtractionCandidate } from "@/lib/knowledge/types";

interface ChatPanelProps {
  session: ChatSession;
  collapsed: boolean;
  onToggleCollapsed: () => void;
  onVoiceStatusChange: (status: VoiceStatus) => void;
  /** Focus a referenced entity in the knowledge graph. */
  onReference: (title: string) => void;
}

/**
 * Translucent dark-glass chat panel docked over the knowledge graph.
 * Collapses into a narrow rail so the graph can go nearly full-screen.
 */
export function ChatPanel({
  session,
  collapsed,
  onToggleCollapsed,
  onVoiceStatusChange,
  onReference,
}: ChatPanelProps) {
  const {
    rooms,
    activeRoom,
    activeRoomId,
    roomAgents,
    input,
    setInput,
    isThinking,
    isStreaming,
    isHydrating,
    offline,
    candidates,
    showCandidates,
    setActiveRoom,
    handleSend,
    handleCreateRoom,
    handleMentionAgent,
    handleAcceptCandidate,
    handleRejectCandidate,
    dismissCandidates,
  } = session;

  const [agentsOpen, setAgentsOpen] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const lead = roomAgents[0];
  const live = isThinking || isStreaming || lead?.status === "busy";
  const setRightPanelOpen = useAppStore((state) => state.setRightPanelOpen);

  // Collapse the chat panel and dock the right panel away — the closest
  // thing to a dedicated fullscreen graph canvas without a separate route.
  const handleExpandGraph = () => {
    setRightPanelOpen(false);
    if (!collapsed) onToggleCollapsed();
  };

  useEffect(() => {
    const isSeededMission =
      activeRoom?.messages.length === 1 &&
      activeRoom.messages[0]?.role === "system" &&
      activeRoom.messages[0]?.content.startsWith("Welcome to Mission Control");
    if (isSeededMission) return;
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [activeRoom?.messages, isThinking]);

  if (collapsed) {
    return (
      <div className="pointer-events-auto absolute bottom-12 left-3 top-3 z-30 flex w-12 flex-col items-center rounded-xl border border-[#1a2a3c] bg-[#08121e]/92 py-3 shadow-2xl backdrop-blur-2xl">
        <button
          type="button"
          onClick={onToggleCollapsed}
          aria-label="Expand chat panel"
          className="flex h-8 w-8 items-center justify-center rounded-lg text-[#697084] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        >
          <PanelLeftOpen className="h-4 w-4" />
        </button>
        <div className="mt-2 flex flex-col items-center gap-1.5">
          <MessageSquare className="h-3.5 w-3.5 text-[#4a5065]" />
          {live && (
            <span
              aria-label="Agent responding"
              className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-amber-400"
            />
          )}
        </div>
      </div>
    );
  }

  return (
    <section
      aria-label="Chat"
      className="pointer-events-auto absolute bottom-4 left-3 top-0 z-30 flex w-[calc(100%-24px)] max-w-[330px] flex-col overflow-hidden rounded-xl border border-[#1a2a3c] bg-[#07111d]/88 shadow-[0_24px_80px_rgba(0,0,0,0.5)] backdrop-blur-2xl xl:max-w-[376px]"
    >
      <ChatHeader
        activeRoom={activeRoom}
        activeRoomId={activeRoomId}
        rooms={rooms}
        lead={lead}
        live={live}
        offline={offline}
        setActiveRoom={setActiveRoom}
        handleCreateRoom={handleCreateRoom}
        onToggleCollapsed={onToggleCollapsed}
        onExpandGraph={handleExpandGraph}
      />

      {/* Thread */}
      {activeRoom ? (
        <MessageThread
          room={activeRoom}
          agents={roomAgents}
          isThinking={isThinking}
          isHydrating={isHydrating}
          messagesEndRef={messagesEndRef}
          onReference={onReference}
        />
      ) : (
        <div className="flex flex-1 items-center justify-center text-[11px] text-[#697084]">
          Select or create a room to start
        </div>
      )}

      {/* Suggested knowledge — extraction review chips */}
      {showCandidates && candidates.length > 0 && (
        <SuggestedKnowledge
          candidates={candidates}
          onAccept={handleAcceptCandidate}
          onReject={handleRejectCandidate}
          onDismiss={dismissCandidates}
        />
      )}

      {/* Composer */}
      <footer className="shrink-0 border-t border-white/[0.06] bg-[#070a10]/50 p-2.5">
        <div className="flex items-end gap-1.5">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                void handleSend();
              }
            }}
            rows={1}
            placeholder={activeRoom ? `Message ${activeRoom.name}…` : "Select a room"}
            aria-label="Message input"
            disabled={!activeRoom || isThinking || isStreaming}
            className="max-h-28 min-h-[34px] flex-1 resize-none rounded-lg border border-white/[0.07] bg-white/[0.03] px-3 py-1.5 text-[12.5px] leading-relaxed text-[#e8eaed] outline-none transition-colors placeholder:text-[#4a5065] focus-visible:border-indigo-400/50 disabled:opacity-50"
          />
          <button
            type="button"
            onClick={() => void handleSend()}
            disabled={!input.trim() || !activeRoom || isThinking || isStreaming}
            aria-label="Send message"
            className="flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg bg-indigo-500/80 text-white outline-none transition-colors hover:bg-indigo-500 focus-visible:ring-2 focus-visible:ring-indigo-400/60 disabled:opacity-35"
          >
            {isThinking || isStreaming ? (
              <Loader2 className="h-3.5 w-3.5 animate-spin" />
            ) : (
              <Send className="h-3.5 w-3.5" />
            )}
          </button>
        </div>

        {/* Controls row: attach / web / agent select / voice */}
        <div className="mt-1.5 flex items-center gap-0.5">
          <button
            type="button"
            aria-label="Attach file"
            title="Attach file"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#697084] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
          >
            <Paperclip className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            aria-label="Search the web"
            title="Search the web"
            className="flex h-7 w-7 items-center justify-center rounded-md text-[#697084] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
          >
            <Globe className="h-3.5 w-3.5" />
          </button>

          {/* Agent selection */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setAgentsOpen((v) => !v)}
              aria-haspopup="listbox"
              aria-expanded={agentsOpen}
              aria-label="Mention an agent"
              title="Mention an agent"
              className="flex h-7 w-7 items-center justify-center rounded-md text-[#697084] outline-none transition-colors hover:bg-white/[0.06] hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
            >
              <AtSign className="h-3.5 w-3.5" />
            </button>
            {agentsOpen && (
              <ul
                role="listbox"
                aria-label="Agents"
                className="absolute bottom-full left-0 z-50 mb-1 w-44 rounded-lg border border-white/[0.08] bg-[#10141d]/95 py-1 shadow-2xl backdrop-blur-xl"
              >
                {roomAgents.map((agent) => (
                  <li key={agent.id} role="option" aria-selected={false}>
                    <button
                      type="button"
                      onClick={() => {
                        handleMentionAgent(agent.name);
                        setAgentsOpen(false);
                      }}
                      className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11.5px] text-[#c8cdd8] transition-colors hover:bg-white/[0.05]"
                    >
                      <span aria-hidden>{agent.avatar}</span>
                      <span className="truncate">{agent.name}</span>
                      {agent.status === "busy" && (
                        <span aria-label="busy" className="ml-auto h-1.5 w-1.5 rounded-full bg-amber-400" />
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="mx-1 h-4 w-px bg-white/[0.06]" aria-hidden />

          <VoiceControls
            agentId={lead?.id}
            roomId={activeRoomId ?? undefined}
            onTranscript={setInput}
            onStatusChange={onVoiceStatusChange}
          />
        </div>
        <div className="mt-1.5 flex h-5 items-center gap-[2px] overflow-hidden px-1" aria-hidden>
          {[5, 9, 14, 8, 17, 11, 6, 13, 18, 10, 7, 15, 9, 17, 12, 6, 14, 19, 11, 8, 16, 10, 6, 13, 8, 15, 10, 5, 12, 7, 9, 4].map((height, index) => (
            <span
              key={`${height}-${index}`}
              className="w-px shrink-0 rounded-full"
              style={{
                height,
                background: `linear-gradient(180deg, ${index > 19 ? "#22d3ee" : "#6366f1"}, #8b5cf6)`,
                opacity: 0.55 + (index % 4) * 0.1,
              }}
            />
          ))}
        </div>
      </footer>
    </section>
  );
}

function SuggestedKnowledge({
  candidates,
  onAccept,
  onReject,
  onDismiss,
}: {
  candidates: ExtractionCandidate[];
  onAccept: (c: ExtractionCandidate) => void;
  onReject: (c: ExtractionCandidate) => void;
  onDismiss: () => void;
}) {
  return (
    <div className="shrink-0 border-t border-white/[0.06] bg-violet-500/[0.04] px-3 py-2">
      <div className="mb-1.5 flex items-center justify-between">
        <span className="text-[9px] font-semibold uppercase tracking-[0.12em] text-violet-300/70">
          Suggested knowledge
        </span>
        <button
          type="button"
          onClick={onDismiss}
          aria-label="Dismiss suggestions"
          className="text-[#697084] outline-none transition-colors hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
        >
          <X className="h-3 w-3" />
        </button>
      </div>
      <div className="space-y-1">
        {candidates.slice(0, 3).map((c) => (
          <div
            key={c.id}
            className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1"
          >
            <span className="rounded bg-violet-500/15 px-1 py-0.5 font-mono text-[8px] uppercase text-violet-300">
              {c.candidateType}
            </span>
            <span className="min-w-0 flex-1 truncate text-[10.5px] text-[#c8cdd8]" title={c.summary}>
              {c.title}
            </span>
            <button
              type="button"
              onClick={() => onAccept(c)}
              aria-label={`Accept ${c.title}`}
              className="flex h-5 w-5 items-center justify-center rounded text-emerald-400 outline-none transition-colors hover:bg-emerald-500/15 focus-visible:ring-2 focus-visible:ring-indigo-400/60"
            >
              <Check className="h-3 w-3" />
            </button>
            <button
              type="button"
              onClick={() => onReject(c)}
              aria-label={`Reject ${c.title}`}
              className="flex h-5 w-5 items-center justify-center rounded text-[#697084] outline-none transition-colors hover:bg-red-500/15 hover:text-red-400 focus-visible:ring-2 focus-visible:ring-indigo-400/60"
            >
              <X className="h-3 w-3" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
