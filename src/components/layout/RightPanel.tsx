"use client";

import { Pin, Archive, Trash2, X, Brain, FileText, CheckSquare, Activity } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import { useMemoryStore } from "@/store/useMemoryStore";
import { useAgentStore } from "@/store/useAgentStore";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";
import { formatDistanceToNow } from "date-fns";
import type { Memory } from "@/types";

const TABS = [
  { id: "activity" as const, label: "Activity", Icon: Activity },
  { id: "memory" as const, label: "Memory", Icon: Brain },
  { id: "files" as const, label: "Files", Icon: FileText },
  { id: "tasks" as const, label: "Tasks", Icon: CheckSquare },
];

export function RightPanel() {
  const { rightPanelTab, setRightPanelTab, setRightPanelOpen } = useAppStore();
  const { memories, pinMemory, archiveMemory, deleteMemory } = useMemoryStore();
  const { agents } = useAgentStore();

  const visibleMemories = memories.filter((m) => !m.archived).slice(0, 20);

  return (
    <aside className="flex flex-col h-full w-64 border-l border-[--border] bg-[--panel] shrink-0">
      {/* Header */}
      <div className="flex items-center justify-between h-14 border-b border-[--border] px-3 shrink-0">
        <div className="flex items-center gap-1">
          {TABS.map(({ id, label, Icon }) => (
            <button
              key={id}
              onClick={() => setRightPanelTab(id)}
              className={cn(
                "flex items-center gap-1 px-2 py-1.5 rounded text-xs transition-colors",
                rightPanelTab === id
                  ? "bg-[--accent] text-[--foreground]"
                  : "text-[--muted-foreground] hover:text-[--foreground]"
              )}
            >
              <Icon className="w-3 h-3" />
              <span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>
        <button
          onClick={() => setRightPanelOpen(false)}
          className="text-[--muted-foreground] hover:text-[--foreground] transition-colors"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>

      {/* Content */}
      <ScrollArea className="flex-1">
        {rightPanelTab === "activity" && <ActivityTab agents={agents} />}
        {rightPanelTab === "memory" && (
          <MemoryTab
            memories={visibleMemories}
            onPin={(id) => pinMemory(id, true)}
            onArchive={(id) => archiveMemory(id, true)}
            onDelete={deleteMemory}
          />
        )}
        {rightPanelTab === "files" && <FilesTab />}
        {rightPanelTab === "tasks" && <TasksTab />}
      </ScrollArea>
    </aside>
  );
}

const PANEL_EVENTS = [
  { id: "1", agent: "Hermes Lisa", action: "Analyzed project requirements", msAgo: 2 * 60 * 1000,  color: "#8B5CF6" },
  { id: "2", agent: "Claude Code", action: "Generated API schema draft",    msAgo: 8 * 60 * 1000,  color: "#3B82F6" },
  { id: "3", agent: "OpenClaw",    action: "Research complete: 12 sources", msAgo: 15 * 60 * 1000, color: "#F59E0B" },
  { id: "4", agent: "System",      action: "WebSocket server started",      msAgo: 32 * 60 * 1000, color: "#10B981" },
  { id: "5", agent: "Hermes Lisa", action: "Memory checkpoint saved",       msAgo: 45 * 60 * 1000, color: "#8B5CF6" },
];

const PANEL_NOW = new Date();

function ActivityTab({ agents }: { agents: import("@/types").Agent[] }) {
  const events = PANEL_EVENTS.map((e) => ({ ...e, time: new Date(PANEL_NOW.getTime() - e.msAgo) }));

  return (
    <div className="p-3 space-y-1">
      <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-3">
        Recent Activity
      </div>
      {events.map((event) => (
        <div
          key={event.id}
          className="flex gap-2.5 py-2 border-b border-[--border] last:border-0 animate-fade-in"
        >
          <div
            className="w-1.5 h-1.5 rounded-full mt-1.5 shrink-0"
            style={{ backgroundColor: event.color }}
          />
          <div className="min-w-0">
            <div className="text-xs font-medium text-[--foreground] truncate">
              {event.agent}
            </div>
            <div className="text-[11px] text-[--muted-foreground] truncate">
              {event.action}
            </div>
            <div className="text-[10px] text-[--muted-foreground] mt-0.5">
              {formatDistanceToNow(event.time, { addSuffix: true })}
            </div>
          </div>
        </div>
      ))}

      {/* Agent status */}
      <div className="mt-4">
        <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-2">
          Agent Status
        </div>
        {agents.map((agent) => (
          <div key={agent.id} className="flex items-center gap-2 py-1.5">
            <div
              className="w-6 h-6 rounded-full flex items-center justify-center text-xs"
              style={{ backgroundColor: agent.color + "22" }}
            >
              {agent.avatar}
            </div>
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[--foreground] truncate">{agent.name}</div>
              <div className="text-[10px] text-[--muted-foreground]">{agent.role}</div>
            </div>
            <StatusDot status={agent.status} />
          </div>
        ))}
      </div>
    </div>
  );
}

function MemoryTab({
  memories,
  onPin,
  onArchive,
  onDelete,
}: {
  memories: Memory[];
  onPin: (id: string, pinned: boolean) => void;
  onArchive: (id: string, archived: boolean) => void;
  onDelete: (id: string) => void;
}) {
  const scopeColors: Record<string, string> = {
    org: "text-purple-400",
    project: "text-blue-400",
    agent: "text-cyan-400",
    session: "text-green-400",
    obsidian: "text-amber-400",
  };

  return (
    <div className="p-3">
      <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-3">
        Memory Store · {memories.length} entries
      </div>
      <div className="space-y-2">
        {memories.map((mem) => (
          <div
            key={mem.id}
            className="group rounded-md border border-[--border] bg-[--muted] p-2.5 hover:border-[--primary]/30 transition-colors"
          >
            <div className="flex items-start justify-between gap-1 mb-1">
              <span className={cn("text-[10px] font-medium uppercase tracking-wide", scopeColors[mem.scope] ?? "text-[--muted-foreground]")}>
                {mem.scope}
              </span>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => onPin(mem.id, !mem.pinned)}
                  className={cn("text-[--muted-foreground] hover:text-[--foreground]", mem.pinned && "text-amber-400")}
                >
                  <Pin className="w-2.5 h-2.5" />
                </button>
                <button onClick={() => onArchive(mem.id, true)} className="text-[--muted-foreground] hover:text-[--foreground]">
                  <Archive className="w-2.5 h-2.5" />
                </button>
                <button onClick={() => onDelete(mem.id)} className="text-[--muted-foreground] hover:text-destructive">
                  <Trash2 className="w-2.5 h-2.5" />
                </button>
              </div>
            </div>
            <p className="text-[11px] text-[--foreground] leading-relaxed line-clamp-2">
              {mem.content}
            </p>
            <div className="flex items-center gap-2 mt-1.5">
              <Badge variant="outline" className="text-[9px] py-0 px-1.5 h-4">
                {mem.type}
              </Badge>
              <span className="text-[10px] text-[--muted-foreground]">
                {Math.round(mem.importanceScore * 10) / 10} importance
              </span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function FilesTab() {
  const files = [
    { name: "project-brief.md", size: "4.2 KB", modified: "2h ago" },
    { name: "api-schema.json", size: "12 KB", modified: "3h ago" },
    { name: "research-notes.md", size: "8.1 KB", modified: "1d ago" },
    { name: "wireframes.fig", size: "2.4 MB", modified: "2d ago" },
  ];

  return (
    <div className="p-3">
      <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-3">
        Project Files
      </div>
      <div className="space-y-1">
        {files.map((file) => (
          <button
            key={file.name}
            className="w-full flex items-center gap-2 px-2 py-2 rounded hover:bg-[--accent] transition-colors text-left"
          >
            <FileText className="w-3.5 h-3.5 text-[--muted-foreground] shrink-0" />
            <div className="flex-1 min-w-0">
              <div className="text-xs text-[--foreground] truncate">{file.name}</div>
              <div className="text-[10px] text-[--muted-foreground]">
                {file.size} · {file.modified}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

function TasksTab() {
  const tasks = [
    { id: "1", title: "Set up database schema", done: true, priority: "high" },
    { id: "2", title: "Build agent chat UI", done: false, priority: "urgent" },
    { id: "3", title: "Implement memory retrieval", done: false, priority: "high" },
    { id: "4", title: "WebSocket integration", done: false, priority: "medium" },
    { id: "5", title: "Auth flow", done: false, priority: "medium" },
  ];

  const priorityColor: Record<string, string> = {
    urgent: "text-red-400",
    high: "text-amber-400",
    medium: "text-blue-400",
    low: "text-[--muted-foreground]",
  };

  return (
    <div className="p-3">
      <div className="text-[10px] uppercase tracking-widest text-[--muted-foreground] mb-3">
        Tasks · {tasks.filter((t) => !t.done).length} remaining
      </div>
      <div className="space-y-1">
        {tasks.map((task) => (
          <div key={task.id} className="flex items-start gap-2 py-2 border-b border-[--border] last:border-0">
            <div
              className={cn(
                "w-4 h-4 rounded border mt-0.5 flex items-center justify-center shrink-0",
                task.done
                  ? "bg-emerald-500/20 border-emerald-500/40"
                  : "border-[--border]"
              )}
            >
              {task.done && <div className="w-2 h-2 rounded-full bg-emerald-500" />}
            </div>
            <div className="flex-1 min-w-0">
              <div className={cn("text-xs", task.done ? "line-through text-[--muted-foreground]" : "text-[--foreground]")}>
                {task.title}
              </div>
              <div className={cn("text-[10px]", priorityColor[task.priority])}>
                {task.priority}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function StatusDot({ status }: { status: string }) {
  const colors: Record<string, string> = {
    online: "bg-emerald-500",
    busy: "bg-amber-500",
    idle: "bg-slate-500",
    offline: "bg-red-500",
  };

  return (
    <div className={cn("w-2 h-2 rounded-full shrink-0", colors[status] ?? "bg-slate-500")} />
  );
}
