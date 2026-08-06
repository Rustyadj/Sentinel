"use client";

import { useState } from "react";
import { Loader2, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { PRIORITIES, STATUS_COLUMNS, type KanbanAgent, type KanbanTask } from "./kanban-constants";

const field = "h-9 w-full rounded-md border border-[--border] bg-[--muted] px-3 text-sm text-[--foreground] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]";
const label = "block text-xs text-[--muted-foreground]";

interface TaskDetailDrawerProps {
  task: KanbanTask;
  agents: KanbanAgent[];
  onClose: () => void;
  onSave: (id: string, patch: Partial<KanbanTask>) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
}

export function TaskDetailDrawer({ task, agents, onClose, onSave, onDelete }: TaskDetailDrawerProps) {
  const [form, setForm] = useState({
    title: task.title,
    description: task.description ?? "",
    status: task.status,
    priority: task.priority,
    assignee: task.assignee ?? "",
    agentId: task.agentId ?? "",
    dueDate: task.dueDate ? task.dueDate.slice(0, 10) : "",
    tags: task.tags.join(", "),
  });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const handleSave = async () => {
    setSaving(true);
    try {
      await onSave(task.id, {
        title: form.title.trim(),
        description: form.description.trim() || null,
        status: form.status,
        priority: form.priority,
        assignee: form.assignee.trim() || null,
        agentId: form.agentId || null,
        dueDate: form.dueDate ? new Date(form.dueDate).toISOString() : null,
        tags: form.tags.split(",").map((t) => t.trim()).filter(Boolean),
      });
      onClose();
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async () => {
    setDeleting(true);
    try {
      await onDelete(task.id);
      onClose();
    } finally {
      setDeleting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <button type="button" aria-label="Close task detail" onClick={onClose} className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative flex h-full w-full max-w-md flex-col overflow-hidden border-l border-[--canvas-card-border] bg-[--canvas-card] shadow-2xl">
        <div className="flex items-center justify-between border-b border-[--canvas-card-border] px-5 py-4">
          <h2 className="text-sm font-semibold text-[--canvas-card-foreground]">Edit task</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="rounded-md p-1.5 text-[--muted-foreground] hover:bg-[--muted] hover:text-[--foreground]">
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <label className={label}>Title
            <input className={cn(field, "mt-1")} value={form.title} onChange={(e) => setForm((f) => ({ ...f, title: e.target.value }))} />
          </label>

          <label className={label}>Description
            <textarea className={cn(field, "mt-1 h-24 resize-none py-2")} value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
          </label>

          <div className="grid grid-cols-2 gap-3">
            <label className={label}>Status
              <select className={cn(field, "mt-1")} value={form.status} onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
                {STATUS_COLUMNS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
              </select>
            </label>
            <label className={label}>Priority
              <select className={cn(field, "mt-1")} value={form.priority} onChange={(e) => setForm((f) => ({ ...f, priority: e.target.value }))}>
                {PRIORITIES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
            </label>
          </div>

          <label className={label}>Assigned agent
            <select className={cn(field, "mt-1")} value={form.agentId} onChange={(e) => setForm((f) => ({ ...f, agentId: e.target.value, assignee: e.target.value ? "" : f.assignee }))}>
              <option value="">None</option>
              {agents.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </label>

          <label className={label}>Human assignee
            <input className={cn(field, "mt-1")} placeholder="Name" value={form.assignee} disabled={!!form.agentId} onChange={(e) => setForm((f) => ({ ...f, assignee: e.target.value }))} />
          </label>

          <label className={label}>Due date
            <input type="date" className={cn(field, "mt-1")} value={form.dueDate} onChange={(e) => setForm((f) => ({ ...f, dueDate: e.target.value }))} />
          </label>

          <label className={label}>Tags (comma-separated)
            <input className={cn(field, "mt-1")} placeholder="design, launch" value={form.tags} onChange={(e) => setForm((f) => ({ ...f, tags: e.target.value }))} />
          </label>
        </div>

        <div className="flex items-center justify-between gap-3 border-t border-[--canvas-card-border] px-5 py-4">
          <button type="button" onClick={handleDelete} disabled={deleting} className="inline-flex h-9 items-center gap-2 rounded-md px-3 text-xs font-medium text-rose-400 hover:bg-rose-500/10 disabled:opacity-50">
            {deleting ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Trash2 className="h-3.5 w-3.5" />}
            Delete task
          </button>
          <button type="button" onClick={handleSave} disabled={saving || !form.title.trim()} className="inline-flex h-9 items-center gap-2 rounded-md bg-[--primary] px-4 text-xs font-medium text-[--primary-foreground] disabled:opacity-50">
            {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : null}
            Save changes
          </button>
        </div>
      </div>
    </div>
  );
}
