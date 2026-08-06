// Sentinel Kanban — shared constants. Deliberately not imported from
// src/lib/workspaces/status.ts: that module's import chain pulls in
// server-only authorization code, which would leak into this client bundle.
// The values themselves must stay in sync with TASK_STATUSES/TASK_PRIORITIES
// there — the API rejects anything outside that set.

export const STATUS_COLUMNS = [
  { key: "backlog", label: "Backlog" },
  { key: "in-progress", label: "In Progress" },
  { key: "review", label: "Review" },
  { key: "done", label: "Done" },
] as const;

export type TaskStatus = (typeof STATUS_COLUMNS)[number]["key"];

export const PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export type TaskPriority = (typeof PRIORITIES)[number];

export const PRIORITY_BAR: Record<TaskPriority, string> = {
  low: "bg-slate-500",
  medium: "bg-[--primary]",
  high: "bg-amber-400",
  urgent: "bg-rose-500",
};

export const PRIORITY_LABEL: Record<TaskPriority, string> = {
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
};

// Matches TopBarAgentIndicator's STATUS_DOT exactly — an agent's presence
// glow should look identical wherever it appears in the shell.
export const AGENT_STATUS_DOT: Record<string, string> = {
  online: "bg-emerald-400",
  busy: "bg-amber-400",
  idle: "bg-sky-400",
  offline: "bg-slate-500",
};

export interface KanbanTask {
  id: string;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  assignee: string | null;
  agentId: string | null;
  dueDate: string | null;
  tags: string[];
  position: number;
  workspaceId: string | null;
  projectId: string | null;
}

export interface KanbanAgent {
  id: string;
  name: string;
  color: string;
  status: string;
  workspaceId: string | null;
}
