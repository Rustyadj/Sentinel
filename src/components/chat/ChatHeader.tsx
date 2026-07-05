"use client";

import { Bot, ChevronDown, Network } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import type { Agent, ChatRoom } from "@/types";

interface ChatHeaderProps {
  room: ChatRoom;
  agents: Agent[];
  isStreaming: boolean;
  showGraph: boolean;
  onToggleGraph: () => void;
}

export function ChatHeader({
  room,
  agents,
  isStreaming,
  showGraph,
  onToggleGraph,
}: ChatHeaderProps) {
  return (
    <div className="h-14 border-b border-[--border] px-4 flex items-center gap-3 bg-[--card] shrink-0">
      <div className="flex items-center gap-2">
        <span className="font-medium text-sm text-[--foreground]">
          {room.name}
        </span>
        <div className="flex items-center gap-1">
          {agents.map((a) => (
            <div
              key={a.id}
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs border border-[--border]"
              style={{ backgroundColor: a.color + "22" }}
              title={`${a.name} · ${a.status}`}
            >
              {a.avatar}
            </div>
          ))}
        </div>
      </div>
      <div className="ml-auto flex items-center gap-2">
        <Badge variant="outline" className="text-[10px] gap-1">
          <div
            className={cn(
              "w-1.5 h-1.5 rounded-full",
              isStreaming
                ? "bg-amber-400 animate-pulse"
                : "bg-emerald-400"
            )}
          />
          {isStreaming ? "responding…" : `${agents.length} agents`}
        </Badge>
        <Button
          size="sm"
          variant={showGraph ? "default" : "ghost"}
          className="h-7 text-xs gap-1"
          onClick={onToggleGraph}
        >
          <Network className="w-3 h-3" />
          Graph
        </Button>
        <Button size="sm" variant="ghost" className="h-7 text-xs gap-1">
          <Bot className="w-3 h-3" />
          Add Agent
          <ChevronDown className="w-3 h-3" />
        </Button>
      </div>
    </div>
  );
}
