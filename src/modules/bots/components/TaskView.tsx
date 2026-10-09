"use client";

import { useState } from "react";
import { formatDistanceToNow } from "date-fns";
import { Button, Notice, Pill, statusTone } from "./bits";
import { api, errorMessage } from "./client";

export interface TaskEvent { seq: number; type: string; summary: string; data: Record<string, unknown>; at: string }
export interface TaskData {
  id: string; botName: string | null; status: string; mode: string; origin: string | null; createdAt: string; startedAt: string | null; finishedAt: string | null; durationMs: number | null;
  input: { task: string | null; context: string | null }; output: { text: string } | null;
  artifacts: { id: string; type: string; title: string; url: string | null }[];
  toolCalls: { tool: string; server: string | null; decision: string; reason: string; at: string }[];
  memory: { read: { retrieved: number; injected: number; dropped: number; scopes: string[]; skipped: string | null } | null; writes: { scope: string | null; accepted: boolean; denied: string | null }[] };
  model: { requested: string | null; actual: string | null; provider: string | null };
  usage: { inputTokens: number | null; outputTokens: number | null; totalTokens: number | null } | null;
  cost: { usd: number | null; note: string }; error: string | null; waitingFor: { approvalRequestId: string; tool: string } | null; events: TaskEvent[];
}

const fmtMs = (ms: number | null) => (ms == null ? "not finished" : ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`);
const fmtN = (n: number | null | undefined) => (n == null ? "not reported" : n.toLocaleString());

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[120px_1fr] gap-3 py-1.5 text-[13px]">
      <dt className="text-[--muted-foreground]">{label}</dt>
      <dd className="min-w-0 break-words text-[--foreground]">{children}</dd>
    </div>
  );
}

const DECISION_TONE = { allowed: "good", denied: "bad", approval: "warn" } as const;

/** What a bot task did, from recorded events. Never model reasoning. */
export function TaskView({ task, onChanged }: { task: TaskData; onChanged?: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const act = async (action: "cancel" | "approve" | "deny") => {
    setBusy(action); setError(null);
    try { await api(`/api/bots/tasks/${task.id}`, { method: "POST", body: { action } }); onChanged?.(); }
    catch (e) { setError(errorMessage(e)); } finally { setBusy(null); }
  };
  const active = ["QUEUED", "RUNNING", "WAITING"].includes(task.status);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <Pill tone={statusTone(task.status)}>{task.status}</Pill>
        {task.mode === "test" ? <Pill>Test</Pill> : null}
        <span className="text-[12px] text-[--muted-foreground]">Started {formatDistanceToNow(new Date(task.createdAt), { addSuffix: true })}{task.origin ? `, asked by ${task.origin}` : ""}</span>
        <span className="ml-auto flex gap-2">
          {task.status === "WAITING" ? (<><Button variant="primary" busy={busy === "approve"} onClick={() => act("approve")}>Approve {task.waitingFor?.tool} and continue</Button><Button busy={busy === "deny"} onClick={() => act("deny")}>Deny</Button></>) : null}
          {active ? <Button variant="danger" busy={busy === "cancel"} onClick={() => act("cancel")}>Cancel task</Button> : null}
        </span>
      </div>
      {error ? <Notice>{error}</Notice> : null}
      {task.status === "WAITING" ? <Notice tone="warn">Sentinel interrupted the session when {task.waitingFor?.tool} was called; the tool may already have started. Approving starts a new task that may use it once.</Notice> : null}
      {task.error ? <Notice>{task.error}</Notice> : null}

      <dl className="divide-y divide-[--border] rounded-lg border border-[--border] px-3">
        <Row label="Model">{task.model.requested ?? "runtime default"}{task.model.actual && task.model.actual !== task.model.requested ? <span className="text-[--muted-foreground]"> (runtime reported {task.model.actual}{task.model.provider ? ` via ${task.model.provider}` : ""})</span> : null}</Row>
        <Row label="Time">{fmtMs(task.durationMs)}</Row>
        <Row label="Tokens">{task.usage ? `${fmtN(task.usage.inputTokens)} in, ${fmtN(task.usage.outputTokens)} out, ${fmtN(task.usage.totalTokens)} total` : "Runtime did not report usage"}</Row>
        <Row label="Cost">{task.cost.usd != null ? `$${task.cost.usd.toFixed(4)}` : "Not priced"}<span className="block text-[11px] text-[--muted-foreground]">{task.cost.note}</span></Row>
        <Row label="Memory read">{task.memory.read ? (task.memory.read.skipped ?? `${task.memory.read.injected} of ${task.memory.read.retrieved} memories used${task.memory.read.dropped ? `, ${task.memory.read.dropped} over budget` : ""} (${task.memory.read.scopes.join(", ") || "no scopes"})`) : "Not yet"}</Row>
        <Row label="Memory write">{task.memory.writes.length ? task.memory.writes.map((w, i) => <span key={i} className="block">{w.denied ?? (w.accepted ? `Stored at ${w.scope} scope` : "Memory gate declined it")}</span>) : "None"}</Row>
      </dl>

      <section aria-label="Tool calls">
        <h4 className="mb-1.5 text-[13px] font-medium">Tools requested</h4>
        {task.toolCalls.length ? (
          <ul className="space-y-1">
            {task.toolCalls.map((call, i) => (
              <li key={i} className="flex flex-wrap items-center gap-2 rounded-md border border-[--border] px-2.5 py-1.5 text-[13px]">
                <Pill tone={DECISION_TONE[call.decision as keyof typeof DECISION_TONE] ?? "neutral"}>{call.decision === "approval" ? "Needs approval" : call.decision === "allowed" ? "Allowed" : "Denied"}</Pill>
                <code className="text-[12px]">{call.tool}</code>
                {call.server ? <span className="text-[--muted-foreground]">{call.server}</span> : null}
                <span className="basis-full text-[12px] text-[--muted-foreground]">{call.reason}</span>
              </li>
            ))}
          </ul>
        ) : <p className="text-[13px] text-[--muted-foreground]">No tools were requested.</p>}
      </section>

      {task.output ? (
        <section aria-label="Output">
          <h4 className="mb-1.5 text-[13px] font-medium">Response</h4>
          <pre className="max-h-[360px] overflow-auto whitespace-pre-wrap break-words rounded-lg border border-[--border] bg-[--background] p-3 text-[13px] leading-5">{task.output.text}</pre>
        </section>
      ) : null}
      {task.artifacts.length ? (
        <section aria-label="Artifacts">
          <h4 className="mb-1.5 text-[13px] font-medium">Assets found in the response</h4>
          <ul className="space-y-1">{task.artifacts.map((a) => <li key={a.id} className="text-[13px]"><Pill>{a.type}</Pill> {a.url ? <a className="text-[--primary] underline-offset-2 hover:underline" href={a.url} target="_blank" rel="noreferrer">{a.title}</a> : a.title}</li>)}</ul>
          <p className="mt-1 text-[11px] text-[--muted-foreground]">Sentinel has not fetched or verified these links.</p>
        </section>
      ) : null}

      <section aria-label="Execution events">
        <h4 className="mb-1.5 text-[13px] font-medium">Events</h4>
        <ol className="space-y-0.5 text-[12px]">
          {task.events.map((event) => (
            <li key={event.seq} className="grid grid-cols-[64px_120px_1fr] gap-2 rounded px-1.5 py-1 hover:bg-[--accent]">
              <time className="tabular-nums text-[--muted-foreground]" dateTime={event.at}>{new Date(event.at).toLocaleTimeString()}</time>
              <span className="text-[--muted-foreground]">{event.type.replaceAll("_", " ")}</span>
              <span className="min-w-0 break-words">{event.summary}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
