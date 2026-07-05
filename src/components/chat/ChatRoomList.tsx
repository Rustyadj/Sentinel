"use client";

import { Plus, Users } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Agent, ChatRoom } from "@/types";

interface ChatRoomListProps {
  rooms: ChatRoom[];
  activeRoomId: string | null;
  agents: Agent[];
  onSelectRoom: (id: string) => void;
  onCreateRoom: () => void;
}

export function ChatRoomList({
  rooms,
  activeRoomId,
  agents,
  onSelectRoom,
  onCreateRoom,
}: ChatRoomListProps) {
  return (
    <div className="w-56 border-r border-[--border] flex flex-col bg-[--sidebar] shrink-0">
      <div className="p-3 border-b border-[--border] flex items-center justify-between">
        <span className="text-xs font-medium text-[--foreground]">Rooms</span>
        <Button
          size="icon"
          variant="ghost"
          className="h-6 w-6"
          onClick={onCreateRoom}
        >
          <Plus className="w-3 h-3" />
        </Button>
      </div>
      <ScrollArea className="flex-1">
        <div className="p-2 space-y-0.5">
          {rooms.map((room) => {
            const roomAgentList = agents.filter((a) =>
              room.agents.includes(a.id)
            );
            return (
              <button
                key={room.id}
                onClick={() => onSelectRoom(room.id)}
                className={cn(
                  "w-full text-left px-2.5 py-2.5 rounded-md transition-colors",
                  room.id === activeRoomId
                    ? "bg-[--primary]/15 text-[--primary]"
                    : "hover:bg-[--accent] text-[--muted-foreground] hover:text-[--foreground]"
                )}
              >
                <div className="flex items-center gap-1.5 mb-1">
                  <Users className="w-3 h-3 shrink-0" />
                  <span className="text-xs font-medium truncate">
                    {room.name}
                  </span>
                </div>
                <div className="flex items-center gap-1">
                  {roomAgentList.slice(0, 3).map((a) => (
                    <span key={a.id} className="text-[11px]" title={a.name}>
                      {a.avatar}
                    </span>
                  ))}
                  {room.messages.length > 0 && (
                    <span className="text-[10px] text-[--muted-foreground] ml-auto">
                      {room.messages.length} msgs
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </ScrollArea>
    </div>
  );
}
