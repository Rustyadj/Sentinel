"use client";

import { Send, AtSign, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { VoiceDock } from "@/components/voice/VoiceDock";
import { cn } from "@/lib/utils";
import type { Agent, ChatRoom } from "@/types";

interface ChatComposerProps {
  room: ChatRoom;
  agents: Agent[];
  input: string;
  isThinking: boolean;
  isStreaming: boolean;
  onInputChange: (value: string) => void;
  onSend: () => void;
  onMentionAgent: (agentName: string) => void;
  onTranscript: (text: string) => void;
}

export function ChatComposer({
  room,
  agents,
  input,
  isThinking,
  isStreaming,
  onInputChange,
  onSend,
  onMentionAgent,
  onTranscript,
}: ChatComposerProps) {
  return (
    <div className="border-t border-[--border] p-4 bg-[--card] shrink-0">
      <div className="max-w-3xl mx-auto">
        <div className="flex items-end gap-2">
          <div className="flex-1 relative">
            <Input
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  onSend();
                }
              }}
              placeholder={`Message ${room.name}… (@Agent to mention)`}
              className="pr-10 bg-[--muted] border-[--border] text-sm"
              disabled={isThinking || isStreaming}
            />
            <button className="absolute right-2 top-1/2 -translate-y-1/2 text-[--muted-foreground] hover:text-[--foreground]">
              <AtSign className="w-3.5 h-3.5" />
            </button>
          </div>
          <Button
            onClick={onSend}
            disabled={!input.trim() || isThinking || isStreaming}
            size="icon"
            className="shrink-0"
          >
            {isThinking || isStreaming ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </Button>
        </div>
        <div className="flex items-center gap-3 mt-2 px-1">
          {agents.map((a) => (
            <button
              key={a.id}
              onClick={() => onMentionAgent(a.name)}
              className="flex items-center gap-1 text-[10px] text-[--muted-foreground] hover:text-[--foreground] transition-colors"
            >
              <span>{a.avatar}</span>
              <span>{a.name}</span>
              {a.status === "busy" && (
                <span className="text-amber-400">●</span>
              )}
            </button>
          ))}
          <span className="ml-auto text-[10px] text-[--muted-foreground]">
            Enter to send · Shift+Enter for newline
          </span>
        </div>
        <VoiceDock
          agentId={agents[0]?.id}
          onTranscript={onTranscript}
        />
      </div>
    </div>
  );
}
