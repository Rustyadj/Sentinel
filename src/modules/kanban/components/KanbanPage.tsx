"use client";

import { useState } from "react";
import { Plus, MoreHorizontal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { KanbanColumn, KanbanCard } from "@/types";

const INITIAL_COLUMNS: KanbanColumn[] = [
  {
    id: "backlog",
    title: "Backlog",
    color: "#6b7280",
    cards: [
      { id: "c1", title: "Design memory review UI", priority: "medium", tags: ["design", "memory"] },
      { id: "c2", title: "WebSocket reconnect logic", priority: "high", tags: ["infra"] },
      { id: "c3", title: "Obsidian vault sync", priority: "low", tags: ["integration"] },
    ],
  },
  {
    id: "in-progress",
    title: "In Progress",
    color: "#3B82F6",
    cards: [
      { id: "c4", title: "Multi-agent chat UI", priority: "urgent", tags: ["ui", "chat"] },
      { id: "c5", title: "Prisma schema setup", priority: "high", tags: ["db"] },
    ],
  },
  {
    id: "review",
    title: "Review",
    color: "#F59E0B",
    cards: [
      { id: "c6", title: "Agent registry types", priority: "medium", tags: ["types"] },
    ],
  },
  {
    id: "done",
    title: "Done",
    color: "#10B981",
    cards: [
      { id: "c7", title: "Next.js app scaffold", priority: "high", tags: ["setup"] },
      { id: "c8", title: "Zustand stores", priority: "medium", tags: ["state"] },
      { id: "c9", title: "Tailwind theme setup", priority: "medium", tags: ["design"] },
    ],
  },
];

const PRIORITY_COLORS: Record<string, string> = {
  urgent: "text-red-400 bg-red-500/10 border-red-500/20",
  high: "text-amber-400 bg-amber-500/10 border-amber-500/20",
  medium: "text-blue-400 bg-blue-500/10 border-blue-500/20",
  low: "text-[--muted-foreground] bg-[--muted] border-[--border]",
};

export function KanbanPage() {
  const [columns] = useState<KanbanColumn[]>(INITIAL_COLUMNS);

  const totalCards = columns.reduce((acc, col) => acc + col.cards.length, 0);

  return (
    <div className="flex flex-col h-full">
      <div className="p-6 pb-4 border-b border-[--border] flex items-center justify-between">
        <div>
          <h1 className="text-xl font-semibold text-[--foreground]">Kanban Board</h1>
          <p className="text-sm text-[--muted-foreground] mt-0.5">
            {totalCards} tasks · {columns.find(c => c.id === "in-progress")?.cards.length ?? 0} in progress
          </p>
        </div>
        <Button size="sm" className="gap-1.5">
          <Plus className="w-4 h-4" />
          Add Card
        </Button>
      </div>

      <div className="flex gap-4 p-6 overflow-x-auto flex-1">
        {columns.map((column) => (
          <div key={column.id} className="flex flex-col w-72 min-w-72 shrink-0">
            {/* Column header */}
            <div className="flex items-center gap-2 mb-3">
              <div className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: column.color }} />
              <span className="text-sm font-medium text-[--foreground]">{column.title}</span>
              <span className="text-xs text-[--muted-foreground] ml-auto">
                {column.cards.length}
              </span>
              <Button size="icon" variant="ghost" className="h-6 w-6">
                <Plus className="w-3 h-3" />
              </Button>
            </div>

            {/* Cards */}
            <div className="flex flex-col gap-2 flex-1">
              {column.cards.map((card) => (
                <KanbanCardComponent key={card.id} card={card} />
              ))}
              <button className="w-full py-2 rounded-md border border-dashed border-[--border] text-xs text-[--muted-foreground] hover:border-[--primary]/40 hover:text-[--foreground] transition-colors">
                + Add card
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function KanbanCardComponent({ card }: { card: KanbanCard }) {
  return (
    <div className="group rounded-lg border border-[--border] bg-[--card] p-3 hover:border-[--primary]/40 transition-colors cursor-grab active:cursor-grabbing">
      <div className="flex items-start justify-between gap-2 mb-2">
        <span className="text-sm text-[--foreground] leading-snug">{card.title}</span>
        <button className="opacity-0 group-hover:opacity-100 transition-opacity text-[--muted-foreground] hover:text-[--foreground]">
          <MoreHorizontal className="w-3.5 h-3.5" />
        </button>
      </div>
      <div className="flex flex-wrap items-center gap-1.5">
        <span className={cn("text-[9px] px-1.5 py-0.5 rounded border font-medium capitalize", PRIORITY_COLORS[card.priority])}>
          {card.priority}
        </span>
        {card.tags.map((tag) => (
          <Badge key={tag} variant="secondary" className="text-[9px] px-1.5 py-0 h-4">
            {tag}
          </Badge>
        ))}
      </div>
    </div>
  );
}
