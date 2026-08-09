"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronDown, Loader2, Plus } from "lucide-react";
import { cn } from "@/lib/utils";
import { TaskCard } from "./TaskCard";
import { TaskDetailDrawer } from "./TaskDetailDrawer";
import { STATUS_COLUMNS, type KanbanAgent, type KanbanTask, type TaskStatus } from "./kanban-constants";

interface WorkspaceSummary {
  id: string;
  name: string;
  color: string;
}

interface KanbanBoardProps {
  workspaces: WorkspaceSummary[];
}

async function patchTask(id: string, patch: Record<string, unknown>): Promise<KanbanTask> {
  const res = await fetch(`/api/tasks/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(patch) });
  if (!res.ok) throw new Error("Failed to update task");
  return res.json() as Promise<KanbanTask>;
}

export function KanbanBoard({ workspaces }: KanbanBoardProps) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [workspacePickerOpen, setWorkspacePickerOpen] = useState(false);
  const [tasks, setTasks] = useState<KanbanTask[]>([]);
  const [agents, setAgents] = useState<KanbanAgent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [addingIn, setAddingIn] = useState<TaskStatus | null>(null);
  const [newTitle, setNewTitle] = useState("");

  const activeWorkspace = workspaces.find((w) => w.id === workspaceId);

  const load = useCallback((wsId: string) => {
    if (!wsId) { setTasks([]); setLoading(false); return; }
    setLoading(true);
    setError("");
    Promise.all([
      fetch(`/api/tasks?workspaceId=${wsId}`, { cache: "no-store" }).then((r) => (r.ok ? r.json() : Promise.reject(new Error("tasks")))),
      fetch("/api/agents", { cache: "no-store" }).then((r) => (r.ok ? r.json() : [])),
    ])
      .then(([taskList, agentList]: [KanbanTask[], KanbanAgent[]]) => {
        setTasks(taskList);
        setAgents(agentList);
      })
      .catch(() => setError("Couldn't load tasks for this workspace."))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    const id = setTimeout(() => load(workspaceId), 0);
    return () => clearTimeout(id);
  }, [workspaceId, load]);

  const agentById = useMemo(() => new Map(agents.map((a) => [a.id, a])), [agents]);
  const columns = useMemo(() => {
    const byStatus = new Map<string, KanbanTask[]>();
    for (const col of STATUS_COLUMNS) byStatus.set(col.key, []);
    for (const task of tasks) {
      const bucket = byStatus.get(task.status) ?? byStatus.get("backlog")!;
      bucket.push(task);
    }
    for (const bucket of byStatus.values()) bucket.sort((a, b) => a.position - b.position);
    return byStatus;
  }, [tasks]);

  const selectedTask = tasks.find((t) => t.id === selectedTaskId) ?? null;

  const moveTask = async (taskId: string, status: TaskStatus) => {
    const task = tasks.find((t) => t.id === taskId);
    if (!task || task.status === status) return;
    const targetCount = columns.get(status)?.length ?? 0;
    const previous = tasks;
    setTasks((prev) => prev.map((t) => (t.id === taskId ? { ...t, status, position: targetCount } : t)));
    try {
      await patchTask(taskId, { status, position: targetCount });
    } catch {
      setTasks(previous);
      setError("Couldn't move that task — reverted.");
    }
  };

  const createTask = async (status: TaskStatus) => {
    const title = newTitle.trim();
    if (!title || !workspaceId) return;
    setNewTitle("");
    setAddingIn(null);
    try {
      const res = await fetch("/api/tasks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, status, workspaceId }),
      });
      if (!res.ok) throw new Error("create failed");
      const created = (await res.json()) as KanbanTask;
      setTasks((prev) => [...prev, created]);
    } catch {
      setError("Couldn't add that task.");
    }
  };

  const saveTask = async (id: string, patch: Partial<KanbanTask>) => {
    const updated = await patchTask(id, patch);
    setTasks((prev) => prev.map((t) => (t.id === id ? updated : t)));
  };

  const deleteTask = async (id: string) => {
    await fetch(`/api/tasks/${id}`, { method: "DELETE" });
    setTasks((prev) => prev.filter((t) => t.id !== id));
  };

  if (!workspaces.length) {
    return (
      <div className="rounded-xl border border-[--canvas-card-border] bg-[--canvas-card] py-12 text-center text-sm text-[--muted-foreground]">
        No accessible workspaces yet — create one to start tracking tasks.
      </div>
    );
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <div className="relative">
          <button
            type="button"
            onClick={() => setWorkspacePickerOpen((o) => !o)}
            className="flex h-9 items-center gap-2 rounded-lg border border-[--border] bg-[--muted] px-3 text-xs text-[--foreground]"
          >
            <span className="h-2 w-2 rounded-full" style={{ backgroundColor: activeWorkspace?.color ?? "#64748b" }} />
            {activeWorkspace?.name ?? "Select workspace"}
            <ChevronDown className="h-3.5 w-3.5 text-[--muted-foreground]" />
          </button>
          {workspacePickerOpen ? (
            <ul className="absolute left-0 top-full z-20 mt-1 w-48 overflow-hidden rounded-lg border border-[--border] bg-[--canvas-card] py-1 shadow-xl">
              {workspaces.map((w) => (
                <li key={w.id}>
                  <button
                    type="button"
                    onClick={() => { setWorkspaceId(w.id); setWorkspacePickerOpen(false); }}
                    className="flex w-full items-center gap-2 px-3 py-2 text-left text-xs text-[--canvas-card-foreground] hover:bg-[--muted]"
                  >
                    <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: w.color }} />{w.name}
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
        {loading ? <Loader2 className="h-4 w-4 animate-spin text-[--muted-foreground]" /> : null}
        {error ? <p className="text-xs text-rose-400">{error}</p> : null}
      </div>

      <div className="grid min-h-0 flex-1 auto-cols-[minmax(260px,1fr)] grid-flow-col gap-4 overflow-x-auto pb-2">
        {STATUS_COLUMNS.map((col) => {
          const columnTasks = columns.get(col.key) ?? [];
          const isDragOver = dragOverStatus === col.key;
          return (
            <div
              key={col.key}
              onDragOver={(e) => { e.preventDefault(); setDragOverStatus(col.key); }}
              onDragLeave={() => setDragOverStatus((s) => (s === col.key ? null : s))}
              onDrop={(e) => {
                e.preventDefault();
                const id = e.dataTransfer.getData("text/plain");
                setDragOverStatus(null);
                setDraggingId(null);
                if (id) void moveTask(id, col.key);
              }}
              className={cn(
                "flex min-h-0 flex-col rounded-xl border bg-[--muted]/30 transition-colors",
                isDragOver ? "border-[--primary]/60 bg-[--primary]/5" : "border-[--border]"
              )}
            >
              <div className="flex items-center justify-between px-3 py-3">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-[--muted-foreground]">{col.label}</h3>
                <span className="rounded-full bg-[--muted] px-2 py-0.5 text-[10px] text-[--muted-foreground]">{columnTasks.length}</span>
              </div>

              <div className="flex-1 space-y-2 overflow-y-auto px-3">
                {columnTasks.map((task) => (
                  <TaskCard
                    key={task.id}
                    task={task}
                    agent={task.agentId ? agentById.get(task.agentId) : undefined}
                    dragging={draggingId === task.id}
                    onDragStart={() => setDraggingId(task.id)}
                    onDragEnd={() => { setDraggingId(null); setDragOverStatus(null); }}
                    onOpen={() => setSelectedTaskId(task.id)}
                  />
                ))}
                {!loading && columnTasks.length === 0 ? (
                  <p className="py-4 text-center text-[11px] text-[--muted-foreground]">No tasks</p>
                ) : null}
              </div>

              <div className="p-3">
                {addingIn === col.key ? (
                  <input
                    autoFocus
                    value={newTitle}
                    onChange={(e) => setNewTitle(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") void createTask(col.key);
                      if (e.key === "Escape") { setAddingIn(null); setNewTitle(""); }
                    }}
                    onBlur={() => { if (!newTitle.trim()) setAddingIn(null); }}
                    placeholder="Task title"
                    className="h-8 w-full rounded-md border border-[--border] bg-[--canvas-card] px-2.5 text-xs text-[--foreground] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]"
                  />
                ) : (
                  <button
                    type="button"
                    onClick={() => setAddingIn(col.key)}
                    className="flex h-8 w-full items-center gap-1.5 rounded-md px-2.5 text-xs text-[--muted-foreground] hover:bg-[--muted] hover:text-[--foreground]"
                  >
                    <Plus className="h-3.5 w-3.5" />Add task
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {selectedTask ? (
        <TaskDetailDrawer
          task={selectedTask}
          agents={agents.filter((a) => a.workspaceId === workspaceId)}
          onClose={() => setSelectedTaskId(null)}
          onSave={saveTask}
          onDelete={deleteTask}
        />
      ) : null}
    </div>
  );
}
