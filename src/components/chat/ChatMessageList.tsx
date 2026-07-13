"use client";

import { useState } from "react";
import {
  Cpu,
  Loader2,
  AlertTriangle,
  ChevronRight,
  Wrench,
} from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { Message, Agent, ChatRoom } from "@/types";

interface ChatMessageListProps {
  room: ChatRoom;
  agents: Agent[];
  isThinking: boolean;
  messagesEndRef: React.RefObject<HTMLDivElement | null>;
}

export function ChatMessageList({
  room,
  agents,
  isThinking,
  messagesEndRef,
}: ChatMessageListProps) {
  return (
    <ScrollArea className="flex-1 p-4">
      <div className="space-y-4 max-w-3xl mx-auto">
        {room.messages.length === 0 && (
          <div className="flex flex-col items-center justify-center py-16 text-center">
            <div className="w-12 h-12 rounded-xl bg-[--primary]/10 flex items-center justify-center mb-4">
              <Cpu className="w-6 h-6 text-[--primary]" />
            </div>
            <div className="text-sm font-medium text-[--foreground] mb-1">
              {room.name}
            </div>
            <div className="text-xs text-[--muted-foreground] max-w-xs">
              {agents.map((a) => a.name).join(", ")}{" "}
              {agents.length === 1 ? "is" : "are"} ready. Start a
              conversation or type @Agent to mention someone.
            </div>
          </div>
        )}
        {room.messages.map((msg) => (
          <MessageBubble key={msg.id} message={msg} />
        ))}
        {isThinking && <ThinkingIndicator agent={agents[0]} />}
        <div ref={messagesEndRef} />
      </div>
    </ScrollArea>
  );
}

function MessageBubble({ message }: { message: Message }) {
  const isUser = message.role === "user";
  const isSystem = message.role === "system";
  const [expanded, setExpanded] = useState(false);

  if (isSystem) {
    return (
      <div className="flex items-center gap-2 py-1 animate-fade-in">
        <div className="flex-1 h-px bg-[--border]" />
        <span className="text-[11px] text-[--muted-foreground] px-2 shrink-0 flex items-center gap-1">
          {message.content.startsWith("⚠") && (
            <AlertTriangle className="w-3 h-3 text-amber-400" />
          )}
          {message.content}
        </span>
        <div className="flex-1 h-px bg-[--border]" />
      </div>
    );
  }

  return (
    <div className={cn("flex gap-3 animate-fade-in", isUser && "flex-row-reverse")}>
      {/* Avatar */}
      <div className="shrink-0 mt-0.5">
        {isUser ? (
          <div className="w-7 h-7 rounded-full bg-[--primary]/20 flex items-center justify-center text-xs text-[--primary] font-medium">
            U
          </div>
        ) : (
          <div
            className="w-7 h-7 rounded-full flex items-center justify-center text-sm"
            style={{ backgroundColor: (message.agentColor ?? "#666") + "22" }}
          >
            {message.agentAvatar ?? "🤖"}
          </div>
        )}
      </div>

      {/* Content */}
      <div className={cn("flex-1 min-w-0", isUser && "flex flex-col items-end")}>
        {/* Header */}
        <div
          className={cn(
            "flex items-center gap-2 mb-1",
            isUser && "flex-row-reverse"
          )}
        >
          <span className="text-xs font-medium text-[--foreground]">
            {isUser ? "You" : (message.agentName ?? "Agent")}
          </span>
          <span suppressHydrationWarning className="text-[10px] text-[--muted-foreground]">
            {formatDistanceToNow(new Date(message.timestamp), {
              addSuffix: true,
            })}
          </span>
          {message.isStreaming && (
            <span className="text-[10px] text-amber-400 flex items-center gap-1">
              <Loader2 className="w-2.5 h-2.5 animate-spin" />
              typing
            </span>
          )}
        </div>

        {/* Reasoning */}
        {message.reasoning && (
          <button
            onClick={() => setExpanded(!expanded)}
            className="flex items-center gap-1 text-[10px] text-[--muted-foreground] mb-1.5 hover:text-[--foreground] transition-colors"
          >
            <ChevronRight
              className={cn(
                "w-3 h-3 transition-transform",
                expanded && "rotate-90"
              )}
            />
            View reasoning
          </button>
        )}
        {message.reasoning && expanded && (
          <div className="mb-2 px-3 py-2 rounded-md border border-[--border] bg-[--muted] text-[11px] text-[--muted-foreground] italic">
            {message.reasoning}
          </div>
        )}

        {/* Bubble */}
        <div
          className={cn(
            "px-3.5 py-2.5 rounded-xl text-sm leading-relaxed max-w-[80%] whitespace-pre-wrap",
            isUser
              ? "bg-[--primary] text-white"
              : "bg-[--card] border border-[--border] text-[--foreground]",
            message.isStreaming && "border-[--primary]/40"
          )}
        >
          {message.content || (
            <span className="text-[--muted-foreground] italic">…</span>
          )}
          {message.isStreaming && (
            <span className="inline-block w-1 h-3.5 bg-[--primary] ml-0.5 animate-pulse rounded-sm align-middle" />
          )}
        </div>

        {/* Tool calls */}
        {message.toolCalls && message.toolCalls.length > 0 && (
          <div className="mt-2 space-y-1">
            {message.toolCalls.map((tc) => (
              <div
                key={tc.id}
                className="flex items-center gap-2 px-2.5 py-1.5 rounded-md bg-[--muted] border border-[--border] text-[11px]"
              >
                <Wrench className="w-3 h-3 text-amber-400 shrink-0" />
                <span className="text-amber-400 font-mono">{tc.name}</span>
                <Badge
                  variant={
                    tc.status === "complete"
                      ? "success"
                      : tc.status === "error"
                      ? "destructive"
                      : "secondary"
                  }
                  className="text-[9px] ml-auto"
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

function ThinkingIndicator({ agent }: { agent?: Agent }) {
  return (
    <div className="flex gap-3 animate-fade-in">
      <div
        className="w-7 h-7 rounded-full flex items-center justify-center text-sm shrink-0"
        style={{ backgroundColor: (agent?.color ?? "#666") + "22" }}
      >
        {agent?.avatar ?? "🤖"}
      </div>
      <div className="bg-[--card] border border-[--border] rounded-xl px-4 py-3 flex items-center gap-2">
        <Loader2 className="w-3.5 h-3.5 text-[--muted-foreground] animate-spin" />
        <span className="text-xs text-[--muted-foreground]">
          {agent?.name ?? "Agent"} is thinking…
        </span>
      </div>
    </div>
  );
}
