"use client";

import { useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Circle,
  FileText,
  FolderOpen,
  Loader2,
  Sparkles,
  Wrench,
} from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { cn } from "@/lib/utils";
import { Badge } from "@/components/ui/badge";
import { ReasoningSummary } from "./ReasoningSummary";
import type { Agent, ChatRoom, Message } from "@/types";

interface MessageThreadProps {
  room: ChatRoom;
  agents: Agent[];
  isThinking: boolean;
  isHydrating: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
  /** Called when a referenced entity chip is clicked (focuses the graph). */
  onReference?: (title: string) => void;
}

// Lightweight reference detection: [[wikilinks]] and *.md / *.ts style file names.
const REFERENCE_PATTERN = /\[\[([^\]]+)\]\]|\b([\w-]+\.(?:md|ts|tsx|py|json|pdf))\b/g;

function extractReferences(content: string): string[] {
  const refs = new Set<string>();
  for (const match of content.matchAll(REFERENCE_PATTERN)) {
    refs.add(match[1] ?? match[2]);
    if (refs.size >= 4) break;
  }
  return Array.from(refs);
}

export function MessageThread({
  room,
  agents,
  isThinking,
  isHydrating,
  messagesEndRef,
  onReference,
}: MessageThreadProps) {
  return (
    <div
      className="flex-1 overflow-y-auto px-3.5 py-3"
      role="log"
      aria-label={`Messages in ${room.name}`}
      aria-live="polite"
    >
      <div className="space-y-4">
        {isHydrating && room.messages.length === 0 && (
          <div className="space-y-3 py-4" aria-label="Loading messages">
            {[0, 1, 2].map((i) => (
              <div key={i} className="flex gap-2.5">
                <div className="h-6 w-6 shrink-0 animate-pulse rounded-full bg-white/[0.05]" />
                <div className="flex-1 space-y-1.5">
                  <div className="h-2.5 w-24 animate-pulse rounded bg-white/[0.05]" />
                  <div className="h-2.5 w-3/4 animate-pulse rounded bg-white/[0.04]" />
                </div>
              </div>
            ))}
          </div>
        )}

        {!isHydrating && room.messages.length === 0 && (
          <div className="flex flex-col items-center py-14 text-center">
            <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl border border-indigo-400/20 bg-indigo-500/10">
              <Sparkles className="h-4 w-4 text-indigo-300" />
            </div>
            <div className="text-[13px] font-medium text-[#e8eaed]">{room.name}</div>
            <div className="mt-1 max-w-[240px] text-[11px] leading-relaxed text-[#697084]">
              {agents.map((a) => a.name).join(", ")}{" "}
              {agents.length === 1 ? "is" : "are"} online. Ask anything — retrieved
              context lights up in the graph behind this panel.
            </div>
          </div>
        )}

        {room.messages.map((msg) => (
          <ThreadMessage key={msg.id} message={msg} onReference={onReference} />
        ))}

        {isThinking && <ThinkingRow agent={agents[0]} />}
        <div ref={messagesEndRef} />
      </div>
    </div>
  );
}

function ThreadMessage({
  message,
  onReference,
}: {
  message: Message;
  onReference?: (title: string) => void;
}) {
  const isUser = message.role === "user";

  if (message.role === "system") {
    if (message.content.startsWith("Welcome to Mission Control")) {
      return <ReferenceWelcomeThread onReference={onReference} />;
    }
    return (
      <div className="flex items-center gap-2 py-1 animate-fade-in">
        <div className="h-px min-w-3 flex-1 bg-white/[0.06]" />
        <span className="flex min-w-0 max-w-[85%] items-start gap-1 px-1 text-center text-[10px] leading-relaxed text-[#697084]">
          {message.content.startsWith("⚠") && (
            <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-amber-400" />
          )}
          <span className="min-w-0">{message.content}</span>
        </span>
        <div className="h-px min-w-3 flex-1 bg-white/[0.06]" />
      </div>
    );
  }

  const references = !isUser && message.content ? extractReferences(message.content) : [];

  return (
    <div className={cn("flex gap-2.5 animate-fade-in", isUser && "flex-row-reverse")}>
      <div className="mt-0.5 shrink-0">
        {isUser ? (
          <div className="flex h-6 w-6 items-center justify-center rounded-full bg-indigo-500/20 text-[10px] font-medium text-indigo-300">
            U
          </div>
        ) : (
          <div
            className="flex h-6 w-6 items-center justify-center rounded-full text-[11px]"
            style={{ backgroundColor: (message.agentColor ?? "#666") + "22" }}
            aria-hidden
          >
            {message.agentAvatar ?? "🤖"}
          </div>
        )}
      </div>

      <div className={cn("min-w-0 flex-1", isUser && "flex flex-col items-end")}>
        <div className={cn("mb-1 flex items-center gap-2", isUser && "flex-row-reverse")}>
          <span className="text-[11px] font-medium text-[#c8cdd8]">
            {isUser ? "You" : (message.agentName ?? "Agent")}
          </span>
          <span className="text-[9px] text-[#4a5065]">
            {formatDistanceToNow(new Date(message.timestamp), { addSuffix: true })}
          </span>
          {message.isStreaming && (
            <span className="flex items-center gap-1 text-[9px] text-amber-400">
              <Loader2 className="h-2.5 w-2.5 animate-spin" />
              responding
            </span>
          )}
        </div>

        <div
          className={cn(
            "whitespace-pre-wrap rounded-xl px-3 py-2 text-[12.5px] leading-relaxed",
            isUser
              ? "max-w-[85%] bg-indigo-500/85 text-white"
              : "max-w-full border border-white/[0.06] bg-white/[0.03] text-[#dde1e9]",
            message.isStreaming && "border-indigo-400/30"
          )}
        >
          {message.content || <span className="italic text-[#697084]">…</span>}
          {message.isStreaming && (
            <span className="ml-0.5 inline-block h-3 w-1 animate-pulse rounded-sm bg-indigo-400 align-middle" />
          )}
        </div>

        {/* Approved reasoning summary — never raw chain-of-thought */}
        {message.reasoning && <ReasoningSummary summary={message.reasoning} />}

        {/* Referenced files / entities */}
        {references.length > 0 && (
          <div className="mt-1.5 flex flex-wrap gap-1">
            {references.map((ref) => (
              <button
                key={ref}
                type="button"
                onClick={() => onReference?.(ref)}
                title={`Focus ${ref} in graph`}
                className="flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.03] px-1.5 py-0.5 text-[9.5px] text-[#9aa1b4] outline-none transition-colors hover:border-indigo-400/40 hover:text-indigo-300 focus-visible:ring-2 focus-visible:ring-indigo-400/60"
              >
                {ref.includes(".") ? (
                  <FileText className="h-2.5 w-2.5" />
                ) : (
                  <FolderOpen className="h-2.5 w-2.5" />
                )}
                {ref}
              </button>
            ))}
          </div>
        )}

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-1.5 space-y-1">
            {message.toolCalls.map((tc) => (
              <div
                key={tc.id}
                className="flex items-center gap-2 rounded-md border border-white/[0.06] bg-white/[0.03] px-2 py-1 text-[10px]"
              >
                <Wrench className="h-2.5 w-2.5 shrink-0 text-amber-400" />
                <span className="font-mono text-amber-400">{tc.name}</span>
                <Badge
                  variant={
                    tc.status === "complete"
                      ? "success"
                      : tc.status === "error"
                        ? "destructive"
                        : "secondary"
                  }
                  className="ml-auto text-[9px]"
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

const REASONING_STEPS = [
  "Analyzing Sentinel workspace data",
  "Researching campaign intelligence",
  "Identifying target audience segments",
  "Building campaign strategy framework",
  "Creating lead generation workflow",
];

function ReferenceWelcomeThread({ onReference }: { onReference?: (title: string) => void }) {
  return (
    <div className="space-y-4" aria-label="Example mission-control conversation">
      <div className="flex gap-2.5 border-b border-white/[0.055] pb-4">
        <div className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-slate-200 text-[9px] font-semibold text-slate-900">
          YOU
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-white">You</span>
            <time className="text-[9px] text-[#68758a]">14:31</time>
          </div>
          <p className="mt-1.5 text-[11px] leading-[1.65] text-[#d7dde7]">
            Build Sentinel&apos;s marketing campaign and create a lead generation strategy.
          </p>
        </div>
      </div>

      <div className="flex gap-2.5">
        <div className="h-7 w-7 shrink-0 rounded-full border border-sky-300/20 bg-[url('/media/hermes-lisa.png')] bg-cover bg-top" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-white">Hermes Lisa</span>
            <time className="text-[9px] text-[#68758a]">14:31</time>
          </div>
          <p className="mt-1.5 text-[11px] leading-[1.65] text-[#c9d1dd]">
            I&apos;ll build a comprehensive campaign with lead generation strategy. Let me analyze the context and gather relevant information.
          </p>
        </div>
      </div>

      <ReferenceReasoningProcess />

      <div className="flex gap-2.5">
        <div className="h-7 w-7 shrink-0 rounded-full border border-sky-300/20 bg-[url('/media/hermes-lisa.png')] bg-cover bg-top" />
        <div className="min-w-0 flex-1">
          <p className="text-[10.5px] leading-[1.6] text-[#cbd3de]">
            Here&apos;s your comprehensive Sentinel campaign strategy:
          </p>
          <button
            type="button"
            className="mt-2 flex w-full items-center gap-2.5 rounded-lg border border-[#1e3045] bg-[#0a1725] p-2.5 text-left hover:border-sky-400/30"
          >
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-red-500/20 text-red-300">
              <FileText className="h-4 w-4" />
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-[10px] font-medium text-[#eef2f7]">Sentinel Campaign Strategy</span>
              <span className="block text-[8.5px] text-[#758195]">24 pages · Campaign Strategy · AI-generated</span>
            </span>
            <ChevronRight className="h-3.5 w-3.5 text-[#758195]" />
          </button>
          <div className="mt-2 flex flex-wrap gap-1" aria-label="Referenced context">
            {[
              { title: "Marketing Strategy", label: "Marketing Strategy · memory", icon: Sparkles },
              { title: "Projects Portfolio", label: "Projects Portfolio · project", icon: FolderOpen },
              { title: "Audience Research", label: "Audience Research · source", icon: FileText },
            ].map(({ title, label, icon: Icon }) => (
              <button
                key={title}
                type="button"
                onClick={() => onReference?.(title)}
                className="flex items-center gap-1 rounded-md border border-white/[0.07] bg-white/[0.025] px-1.5 py-1 text-[8.5px] text-[#8f9bad] outline-none transition-colors hover:border-violet-400/35 hover:text-violet-200 focus-visible:ring-2 focus-visible:ring-violet-400/55"
              >
                <Icon className="h-2.5 w-2.5" />
                {label}
              </button>
            ))}
          </div>
          <div className="mt-3 text-[9.5px] leading-[1.75] text-[#aeb8c6]">
            <div className="mb-1 text-[#d9dfe8]">Key Components:</div>
            <ul className="space-y-0.5 pl-3">
              <li>• Brand positioning &amp; messaging</li>
              <li>• Digital marketing strategy</li>
              <li>• Lead generation funnels</li>
              <li>• Content marketing plan</li>
              <li>• Analytics &amp; KPI dashboard</li>
            </ul>
          </div>
        </div>
      </div>
    </div>
  );
}

function ReferenceReasoningProcess() {
  const [expanded, setExpanded] = useState(true);

  return (
    <div className="rounded-lg border border-[#1b2b3e] bg-[#0a1624]/88 p-3">
      <button
        type="button"
        onClick={() => setExpanded((value) => !value)}
        aria-expanded={expanded}
        className="flex w-full items-center gap-2 text-left text-[10.5px] font-medium text-[#e5eaf2] outline-none focus-visible:ring-2 focus-visible:ring-violet-400/55"
      >
        <span className="h-2 w-2 rounded-full bg-violet-500 shadow-[0_0_10px_rgba(139,92,246,0.75)]" />
        Reasoning summary
        <span className="ml-1 text-[8.5px] font-normal text-[#6f7d91]">Approved steps only</span>
        <ChevronRight className={cn("ml-auto h-3 w-3 text-[#758195] transition-transform", expanded && "rotate-90")} />
      </button>
      {expanded ? (
        <div className="mt-3 space-y-2.5">
          {REASONING_STEPS.map((step, index) => (
            <div key={step} className="flex items-center gap-2 text-[9.5px] text-[#8d99aa]">
              {index < 4 ? (
                <Check className="h-3 w-3 shrink-0 text-emerald-400" />
              ) : (
                <Circle className="h-3 w-3 shrink-0 text-amber-400" />
              )}
              <span className={index === 4 ? "text-[#d6dce5]" : undefined}>{step}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function ThinkingRow({ agent }: { agent?: Agent }) {
  return (
    <div className="flex gap-2.5 animate-fade-in" aria-label={`${agent?.name ?? "Agent"} is thinking`}>
      <div
        className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[11px]"
        style={{ backgroundColor: (agent?.color ?? "#666") + "22" }}
        aria-hidden
      >
        {agent?.avatar ?? "🤖"}
      </div>
      <div className="flex items-center gap-2 rounded-xl border border-white/[0.06] bg-white/[0.03] px-3 py-2">
        <Loader2 className="h-3 w-3 animate-spin text-[#697084]" />
        <span className="text-[11px] text-[#697084]">
          {agent?.name ?? "Agent"} is thinking…
        </span>
      </div>
    </div>
  );
}
