"use client";

import { useEffect, useRef, useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { AlertTriangle, GitBranch, Lock, ShieldAlert, Terminal } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import type { TaskDetail } from "@/lib/tasks/detail";
import type { CollaborationEventType } from "@/types/collaboration";
import type { RuntimeEventType } from "@/lib/agents/runtime/types";

const RUNTIME_EVENT_TYPES: RuntimeEventType[] = [
  "session_started", "status", "stdout", "stderr", "assistant_delta",
  "tool_started", "tool_completed", "approval_required", "file_changed",
  "command_started", "command_completed", "warning", "error", "delegated", "cancelled",
];

function humanize(type: string): string {
  return type.replace(/[._]/g, " ");
}

function describeTimelineEvent(type: string): string {
  const known: Partial<Record<CollaborationEventType, string>> = {
    "task.created": "Task created",
    "task.claimed": "Claimed",
    "task.started": "Started",
    "task.blocked": "Blocked",
    "task.completed": "Completed",
    "task.review_requested": "Review requested",
    "task.review_failed": "Review changes requested",
    "task.approved": "Approved",
    "artifact.created": "Artifact produced",
    "artifact.modified": "Artifact updated",
    "approval.requested": "Approval requested",
    "approval.granted": "Approval granted",
    "approval.denied": "Approval denied",
    "agent.failed": "Agent failed",
  };
  return known[type as CollaborationEventType] ?? humanize(type);
}

interface LiveLine {
  id: string;
  type: string;
  text: string;
  at: string;
}

function summarizeRuntimeEvent(type: string, data: Record<string, unknown>): string {
  const str = (key: string) => (typeof data[key] === "string" ? (data[key] as string) : undefined);
  switch (type) {
    case "tool_started": return `called ${str("tool") ?? "a tool"}`;
    case "tool_completed": return `finished ${str("tool") ?? "a tool call"}`;
    case "file_changed": return `changed ${str("path") ?? "a file"}`;
    case "command_started": return `ran ${str("command") ?? "a command"}`;
    case "command_completed": return "command finished";
    case "approval_required": return "waiting on approval";
    case "error": return str("message") ?? "error";
    case "warning": return str("message") ?? "warning";
    case "session_started": return "session started";
    case "cancelled": return "cancelled";
    case "delegated": return "delegated";
    default: return humanize(type);
  }
}

function LiveSessionPanel({ sessionId }: { sessionId: string }) {
  const [lines, setLines] = useState<LiveLine[]>([]);
  const [connected, setConnected] = useState(false);
  const logRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const source = new EventSource(`/api/agent-sessions/${sessionId}/events`);
    source.onopen = () => setConnected(true);
    source.onerror = () => setConnected(false);

    const handlers = RUNTIME_EVENT_TYPES.map((type) => {
      const handler = (event: MessageEvent) => {
        try {
          const payload = JSON.parse(event.data) as { type: string; sequence?: number; data?: Record<string, unknown> };
          if (payload.type === "stdout" || payload.type === "stderr" || payload.type === "assistant_delta") return;
          setLines((prev) => [
            ...prev.slice(-199),
            { id: `${payload.sequence ?? prev.length}`, type: payload.type, text: summarizeRuntimeEvent(payload.type, payload.data ?? {}), at: new Date().toISOString() },
          ]);
        } catch {
          // malformed event payload — skip rather than break the stream
        }
      };
      source.addEventListener(type, handler);
      return { type, handler };
    });

    return () => {
      handlers.forEach(({ type, handler }) => source.removeEventListener(type, handler));
      source.close();
    };
  }, [sessionId]);

  useEffect(() => {
    logRef.current?.scrollTo({ top: logRef.current.scrollHeight });
  }, [lines]);

  return (
    <section className="rounded-lg border border-[--canvas-card-border]">
      <div className="flex items-center justify-between border-b border-[--canvas-card-border] px-4 py-2.5">
        <h2 className="flex items-center gap-1.5 text-[12px] font-medium text-[--canvas-foreground]">
          <Terminal className="h-3.5 w-3.5" /> Live
        </h2>
        <span className={`h-1.5 w-1.5 rounded-full ${connected ? "bg-emerald-400" : "bg-amber-400"}`} aria-label={connected ? "Connected" : "Connecting"} />
      </div>
      <div ref={logRef} className="max-h-64 overflow-y-auto px-4 py-2.5 font-mono text-[11px] text-[--muted-foreground]">
        {lines.length === 0 ? (
          <p>Waiting for activity…</p>
        ) : (
          lines.map((line) => (
            <div key={line.id} className="py-0.5">
              <span className="text-[--canvas-foreground]">{line.type}</span> — {line.text}
            </div>
          ))
        )}
      </div>
    </section>
  );
}

export function TaskDetailConsole({ detail }: { detail: TaskDetail }) {
  const { task, ownerName, reviewerName, creatorName, timeline, locks, approvals, disagreements, artifacts, liveSessionId } = detail;
  const openLocks = locks.filter((lock) => !lock.releasedAt);
  const pendingApprovals = approvals.filter((approval) => approval.status === "pending");
  const openDisagreements = disagreements.filter((d) => !d.resolvedAt);
  const hasBlockers = openLocks.length > 0 || pendingApprovals.length > 0 || openDisagreements.length > 0;

  return (
    <WorkspaceShell>
      <WorkspaceHeader title={task.title} description={task.description ?? undefined} />

      <div className="mb-6 flex flex-wrap items-center gap-2">
        <Badge variant="secondary" className="capitalize">{task.status.toLowerCase().replace(/_/g, " ")}</Badge>
        <Badge variant="outline" className="capitalize">{task.priority}</Badge>
        {task.workspace ? (
          <span className="inline-flex items-center gap-1.5 text-[12px] text-[--muted-foreground]">
            <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: task.workspace.color }} />
            {task.workspace.name}
          </span>
        ) : null}
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {liveSessionId ? <LiveSessionPanel sessionId={liveSessionId} /> : null}

          <section className="rounded-lg border border-[--canvas-card-border]">
            <h2 className="border-b border-[--canvas-card-border] px-4 py-2.5 text-[12px] font-medium text-[--canvas-foreground]">Timeline</h2>
            <ol className="divide-y divide-[--canvas-card-border]">
              {timeline.map((event) => (
                <li key={event.id} className="flex items-center justify-between px-4 py-2 text-[12px]">
                  <span className="text-[--canvas-foreground]">{describeTimelineEvent(event.type)}</span>
                  <time className="text-[11px] text-[--muted-foreground]" suppressHydrationWarning>
                    {formatDistanceToNow(event.occurredAt, { addSuffix: true })}
                  </time>
                </li>
              ))}
              {timeline.length === 0 ? (
                <li className="px-4 py-6 text-center text-[12px] text-[--muted-foreground]">No orchestration events recorded for this task yet.</li>
              ) : null}
            </ol>
          </section>

          {artifacts.length > 0 ? (
            <section className="rounded-lg border border-[--canvas-card-border]">
              <h2 className="border-b border-[--canvas-card-border] px-4 py-2.5 text-[12px] font-medium text-[--canvas-foreground]">Artifacts</h2>
              <ul className="divide-y divide-[--canvas-card-border]">
                {artifacts.map((artifact) => (
                  <li key={artifact.id} className="px-4 py-2.5 text-[12px]">
                    <div className="flex items-center justify-between">
                      <span className="font-medium text-[--canvas-foreground]">{artifact.title}</span>
                      <Badge variant="outline">{artifact.type}</Badge>
                    </div>
                    {artifact.content ? (
                      <p className="mt-1 line-clamp-2 text-[11px] text-[--muted-foreground]">{artifact.content}</p>
                    ) : null}
                  </li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>

        <div className="space-y-6">
          <section className="rounded-lg border border-[--canvas-card-border] p-4 text-[12px]">
            <h2 className="mb-3 text-[11px] font-medium uppercase tracking-wide text-[--muted-foreground]">Ownership</h2>
            <dl className="space-y-2">
              <div className="flex items-center justify-between"><dt className="text-[--muted-foreground]">Owner</dt><dd>{ownerName ?? "Unassigned"}</dd></div>
              {reviewerName ? <div className="flex items-center justify-between"><dt className="text-[--muted-foreground]">Reviewer</dt><dd>{reviewerName}</dd></div> : null}
              {creatorName ? <div className="flex items-center justify-between"><dt className="text-[--muted-foreground]">Created by</dt><dd>{creatorName}</dd></div> : null}
            </dl>
          </section>

          <section className="rounded-lg border border-[--canvas-card-border] p-4 text-[12px]">
            <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-[--muted-foreground]">
              <GitBranch className="h-3.5 w-3.5" /> Repository
            </h2>
            <dl className="space-y-2 font-mono text-[11px]">
              <div><dt className="text-[--muted-foreground]">Branch</dt><dd className="truncate">{task.branch ?? "—"}</dd></div>
              <div><dt className="text-[--muted-foreground]">Base</dt><dd className="truncate">{task.baseBranch ?? "—"}</dd></div>
              <div><dt className="text-[--muted-foreground]">Worktree</dt><dd className="truncate">{task.worktreePath ?? "—"}</dd></div>
            </dl>
          </section>

          {hasBlockers ? (
            <section className="rounded-lg border border-amber-500/30 bg-amber-500/[0.04] p-4 text-[12px]">
              <h2 className="mb-3 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wide text-amber-400">
                <AlertTriangle className="h-3.5 w-3.5" /> Blockers
              </h2>
              <ul className="space-y-2">
                {pendingApprovals.map((approval) => (
                  <li key={approval.id} className="flex items-center gap-1.5"><ShieldAlert className="h-3.5 w-3.5 shrink-0 text-amber-400" /> Approval pending: {approval.title}</li>
                ))}
                {openLocks.map((lock) => (
                  <li key={lock.id} className="flex items-center gap-1.5"><Lock className="h-3.5 w-3.5 shrink-0 text-amber-400" /> Locked by {lock.agentId} ({lock.resourcePattern})</li>
                ))}
                {openDisagreements.map((d) => (
                  <li key={d.id} className="flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5 shrink-0 text-amber-400" /> Disagreement: {d.issue}</li>
                ))}
              </ul>
            </section>
          ) : null}
        </div>
      </div>
    </WorkspaceShell>
  );
}
