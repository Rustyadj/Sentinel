"use client";

import { useMemo, useState } from "react";
import { Plus, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ChatRoom } from "@/types";
import { useShellStore } from "@/store/useShellStore";
import { IconButton } from "./primitives";

/**
 * Conversation history as a drawer, not a permanent column: it overlays the
 * conversation and gives the width straight back when dismissed.
 */
export function ConversationDrawer({ rooms, activeRoomId, onSelect, onCreate }: {
  rooms: ChatRoom[];
  activeRoomId: string | null;
  onSelect: (roomId: string) => void;
  onCreate: () => void;
}) {
  const { conversationDrawerOpen, setConversationDrawerOpen } = useShellStore();
  const [query, setQuery] = useState("");

  // Search covers conversation titles and loaded message content.
  const matches = useMemo(() => {
    const term = query.trim().toLowerCase();
    if (!term) return rooms;
    return rooms.filter((room) =>
      room.name.toLowerCase().includes(term) ||
      room.messages.some((message) => message.content.toLowerCase().includes(term)));
  }, [rooms, query]);

  if (!conversationDrawerOpen) return null;

  return (
    <div className="absolute inset-0 z-30 flex" role="dialog" aria-label="Conversations">
      <div className="flex w-[19rem] flex-col bg-[--card] shadow-[var(--shadow-lg)]">
        <div className="flex items-center gap-2 px-3 py-3">
          <span className="flex-1 text-[14px] font-medium">Conversations</span>
          <IconButton label="New chat" onClick={onCreate}><Plus className="h-4 w-4" /></IconButton>
          <IconButton label="Close conversations" onClick={() => setConversationDrawerOpen(false)}><X className="h-4 w-4" /></IconButton>
        </div>

        <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg bg-[--muted] px-2.5 py-1.5">
          <Search className="h-3.5 w-3.5 text-[--muted-foreground]" />
          <input
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search conversations"
            className="w-full bg-transparent text-[13px] text-[--foreground] outline-none placeholder:text-[--muted-foreground]"
          />
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-2 pb-3">
          {matches.length === 0 ? (
            <p className="px-2 py-6 text-center text-[13px] text-[--muted-foreground]">
              {rooms.length === 0 ? "No conversations yet." : "No conversations match that search."}
            </p>
          ) : matches.map((room) => (
            <button
              key={room.id}
              onClick={() => { onSelect(room.id); setConversationDrawerOpen(false); }}
              className={cn(
                "block w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                room.id === activeRoomId ? "bg-[--muted] text-[--foreground]" : "text-[--muted-foreground] hover:bg-[--muted] hover:text-[--foreground]",
              )}
            >
              {room.name}
            </button>
          ))}
        </div>
      </div>

      <button
        aria-label="Close conversations"
        className="flex-1 bg-black/10"
        onClick={() => setConversationDrawerOpen(false)}
      />
    </div>
  );
}
