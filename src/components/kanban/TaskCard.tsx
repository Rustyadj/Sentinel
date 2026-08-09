"use client";

import { Bot, Calendar } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  AGENT_STATUS_DOT,
  PRIORITY_BAR,
  PRIORITY_LABEL,
  type KanbanAgent,
  type KanbanTask,
  type TaskPriority,
} from "./kanban-constants";

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? "") + (parts[1]?.[0] ?? "")).toUpperCase() || "?";
}

function formatDueDate(iso: string): string {
  const date = new Date(iso);
  const today = new Date();
  const diffDays = Math.round((date.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000);
  if (diffDays === 0) return "Today";
  if (diffDays === 1) return "Tomorrow";
  if (diffDays === -1) return "Yesterday";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

interface TaskCardProps {
  task: KanbanTask;
  agent?: KanbanAgent;
  dragging: boolean;
  onDragStart: () => void;
  onDragEnd: () => void;
  onOpen: () => void;
}

/**
 * The board's signature: an agent-owned card carries that agent's live
 * presence glow (same dot/status vocabulary as TopBarAgentIndicator)
 * instead of a static avatar — at a glance you can tell a human task from
 * one an AI agent is actively working, which is the one thing that makes
 * this board specific to a multi-agent ops shell rather than a generic
 * Trello clone.
 */
export function TaskCard({ task, agent, dragging, onDragStart, onDragEnd, onOpen }: TaskCardProps) {
  const priority = (task.priority in PRIORITY_BAR ? task.priority : "medium") as TaskPriority;
  const isOverdue = task.dueDate ? new Date(task.dueDate) < new Date(new Date().setHours(0, 0, 0, 0)) : false;

  return (
    <div
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", task.id);
        e.dataTransfer.effectAllowed = "move";
        onDragStart();
      }}
      onDragEnd={onDragEnd}
      onClick={onOpen}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => { if (e.key === "Enter") onOpen(); }}
      className={cn(
        "group flex cursor-grab gap-2.5 rounded-lg border border-[--canvas-card-border] bg-[--canvas-card] p-3 text-left shadow-sm transition-all active:cursor-grabbing",
        "hover:border-[--primary]/40 hover:shadow-md",
        dragging && "opacity-40"
      )}
    >
      <span className={cn("mt-0.5 w-1 shrink-0 rounded-full self-stretch", PRIORITY_BAR[priority])} aria-hidden />
      <div className="min-w-0 flex-1 space-y-2">
        <p className="text-[13px] font-medium leading-snug text-[--canvas-card-foreground]">{task.title}</p>

        {task.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1">
            {task.tags.map((tag) => (
              <span key={tag} className="rounded-full bg-[--muted] px-2 py-0.5 text-[10px] text-[--muted-foreground]">{tag}</span>
            ))}
          </div>
        ) : null}

        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-1.5 text-[10px] text-[--muted-foreground]">
            {task.dueDate ? (
              <span className={cn("flex items-center gap-1", isOverdue && "text-rose-400")}>
                <Calendar className="h-3 w-3" />{formatDueDate(task.dueDate)}
              </span>
            ) : (
              <span className="uppercase tracking-wide">{PRIORITY_LABEL[priority]}</span>
            )}
          </div>

          {agent ? (
            <span className="flex items-center gap-1 rounded-full bg-[--muted] py-0.5 pl-1.5 pr-2 text-[10px] text-[--muted-foreground]" title={`${agent.name} · ${agent.status}`}>
              <span className="relative flex h-2.5 w-2.5 items-center justify-center">
                <span className={cn("h-1.5 w-1.5 rounded-full", AGENT_STATUS_DOT[agent.status] ?? "bg-slate-500", (agent.status === "online" || agent.status === "busy") && "animate-pulse")} />
              </span>
              <Bot className="h-3 w-3" />
              {agent.name}
            </span>
          ) : task.assignee ? (
            <span className="flex h-5 w-5 items-center justify-center rounded-full bg-[--muted] text-[9px] font-medium text-[--muted-foreground]" title={task.assignee}>
              {initials(task.assignee)}
            </span>
          ) : null}
        </div>
      </div>
    </div>
  );
}
