"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { OctagonX, Pause, Play, RotateCcw, Square } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import { cn } from "@/lib/utils";
import { AUTONOMY_LABELS, type AutonomyLevel, type CompletionReport } from "@/lib/objectives/types";

type BadgeVariant = "default" | "secondary" | "success" | "warning" | "destructive" | "outline";
const STATUS_VARIANT: Record<string, BadgeVariant> = {
  completed: "success", running: "default", pending: "secondary", retry_wait: "warning", waiting_approval: "warning",
  paused: "secondary", blocked: "destructive", failed: "destructive", advised: "outline", cancelled: "outline", stopped: "outline",
};
const label = (s: string) => s.replace(/_/g, " ");
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

interface ObjectiveSummary { id: string; title: string; status: string; autonomyLevel: number; budgetCents: number; spentCents: number; createdAt: string; steps: { status: string }[] }
interface Step {
  id: string; key: string; title: string; role: string; kind: string; status: string; impact: string; dependsOn: string[];
  attempts: number; blockedReason: string | null; unblockRequest: string | null; error: string | null; approvalRequestId: string | null;
  estimatedCostCents: number; actualCostCents: number; verification: { passed?: boolean; checks?: { name: string; passed: boolean }[] };
}
interface ObjectiveEvent { id: string; type: string; message: string; stepKey: string | null; createdAt: string }
interface Detail {
  objective: { id: string; title: string; goal: string; status: string; autonomyLevel: number; budgetCents: number; spentCents: number; report: Partial<CompletionReport>; stopReason: string | null };
  steps: Step[];
  events: ObjectiveEvent[];
}

async function send(url: string, method: string, body: unknown) {
  const res = await fetch(url, { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    // The planner asks only for what it is missing; show its questions, not just "missing".
    const questions = Array.isArray(data.missing) ? data.missing.map((m: { question?: unknown }) => String(m.question ?? "")).filter(Boolean).join(" ") : "";
    throw new Error(`${typeof data.error === "string" ? data.error : `Request failed (${res.status})`}${questions ? ` ${questions}` : ""}`);
  }
  return data;
}

export function ObjectivesConsole({ enabled, workspaces }: { enabled: boolean; workspaces: { id: string; name: string }[] }) {
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [objectives, setObjectives] = useState<ObjectiveSummary[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const loadList = useCallback(async () => {
    if (!workspaceId) return;
    const res = await fetch(`/api/objectives?workspaceId=${encodeURIComponent(workspaceId)}`);
    if (res.ok) setObjectives((await res.json()).objectives ?? []);
  }, [workspaceId]);

  const loadDetail = useCallback(async () => {
    if (!selected) return;
    const res = await fetch(`/api/objectives/${encodeURIComponent(selected)}`);
    if (res.ok) {
      const next = (await res.json()) as Detail;
      setDetail(next.objective.id === selected ? next : null);
    }
  }, [selected]);

  // Fetch-then-set happens after an await, so these effects never set state synchronously.
  useEffect(() => { const t = setTimeout(() => void loadList(), 0); return () => clearTimeout(t); }, [loadList]);
  useEffect(() => { const t = setTimeout(() => void loadDetail(), 0); return () => clearTimeout(t); }, [loadDetail]);
  // Live view: refresh while the selected objective is still moving.
  const live = detail && ["running", "waiting_approval"].includes(detail.objective.status);
  useEffect(() => {
    if (!live) return;
    const timer = setInterval(() => { void loadDetail(); void loadList(); }, 4000);
    return () => clearInterval(timer);
  }, [live, loadDetail, loadList]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true); setError(null);
    try { await fn(); await Promise.all([loadDetail(), loadList()]); } catch (e) { setError(e instanceof Error ? e.message : "Action failed"); } finally { setBusy(false); }
  };

  return (
    <WorkspaceShell>
      <WorkspaceHeader
        title="Objectives"
        description="Hand Sentinel one goal. It plans the work, delegates it, asks only when it must, and verifies every result."
        showBack={false}
        actions={workspaceId ? (
          <Button variant="destructive" size="sm" disabled={busy} onClick={() => act(() => send("/api/objectives/emergency-stop", "POST", { workspaceId }))}>
            <OctagonX className="mr-1.5 h-3.5 w-3.5" /> Emergency stop
          </Button>
        ) : null}
      />
      {!enabled ? (
        <p className="mb-4 rounded-lg border border-(--border) bg-(--muted) px-3 py-2 text-[13px] text-(--muted-foreground)">
          The objective engine is off on this deployment. Set <code className="font-mono">SENTINEL_OBJECTIVES=on</code> on the app and orchestration-worker to enable it.
        </p>
      ) : null}
      {error ? <p role="alert" className="mb-4 rounded-lg border border-(--status-error) px-3 py-2 text-[13px] text-(--status-error)">{error}</p> : null}

      <div className="grid gap-6 xl:grid-cols-[340px_minmax(0,1fr)]">
        <div className="space-y-6">
          <CreateForm workspaces={workspaces} workspaceId={workspaceId} onWorkspace={setWorkspaceId} disabled={!enabled || busy}
            onCreate={(body) => act(async () => { const res = await send("/api/objectives", "POST", body); setSelected(res.objective.id); })} />
          <ul className="space-y-1.5" aria-label="Objectives">
            {objectives.length === 0 ? <li className="text-[13px] text-(--muted-foreground)">No objectives yet.</li> : null}
            {objectives.map((o) => {
              const done = o.steps.filter((s) => s.status === "completed").length;
              return (
                <li key={o.id}>
                  <button type="button" onClick={() => setSelected(o.id)} aria-current={selected === o.id}
                    className={cn("w-full rounded-lg border px-3 py-2 text-left transition-colors", selected === o.id ? "border-(--border-strong) bg-(--card)" : "border-transparent hover:bg-(--muted)")}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="truncate text-[13px] font-medium">{o.title}</span>
                      <Badge variant={STATUS_VARIANT[o.status] ?? "secondary"} className="capitalize">{label(o.status)}</Badge>
                    </div>
                    <div className="mt-0.5 font-mono text-[11px] text-(--muted-foreground)">{done}/{o.steps.length} verified · {money(o.spentCents)} of {money(o.budgetCents)}</div>
                  </button>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="min-w-0">
          {detail && detail.objective.id === selected ? <DetailView detail={detail} busy={busy} act={act} /> : (
            <div className="rounded-lg border border-dashed border-(--border) p-10 text-center text-[13px] text-(--muted-foreground)">Select or create an objective to watch it run.</div>
          )}
        </div>
      </div>
    </WorkspaceShell>
  );
}

function CreateForm({ workspaces, workspaceId, onWorkspace, onCreate, disabled }: {
  workspaces: { id: string; name: string }[]; workspaceId: string; onWorkspace(id: string): void; disabled: boolean;
  onCreate(body: Record<string, unknown>): void;
}) {
  const [goal, setGoal] = useState("");
  const [level, setLevel] = useState<AutonomyLevel>(3);
  const [budget, setBudget] = useState("50");
  const field = "w-full rounded-md border border-(--border) bg-(--field) px-2.5 py-1.5 text-[13px] focus-visible:outline-2 focus-visible:outline-(--ring)";
  return (
    <form className="space-y-3 rounded-lg border border-(--border) bg-(--card) p-4" onSubmit={(e) => {
      e.preventDefault();
      onCreate({ workspaceId, goal, autonomyLevel: level, budgetCents: Math.round(Number(budget || "0") * 100) });
    }}>
      <h2 className="text-[14px] font-semibold">New objective</h2>
      <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Workspace
        <select className={field} value={workspaceId} onChange={(e) => onWorkspace(e.target.value)}>
          {workspaces.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
      </label>
      <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Goal
        <textarea className={cn(field, "min-h-24")} required maxLength={4000} value={goal} onChange={(e) => setGoal(e.target.value)}
          placeholder="Create a new business called Titan Marketing. Register a domain, configure business email, build a website, set up a CRM." />
      </label>
      <div className="grid grid-cols-2 gap-3">
        <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Autonomy
          <select className={field} value={level} onChange={(e) => setLevel(Number(e.target.value) as AutonomyLevel)}>
            {([1, 2, 3, 4] as AutonomyLevel[]).map((l) => <option key={l} value={l}>{l} · {AUTONOMY_LABELS[l]}</option>)}
          </select>
        </label>
        <label className="block space-y-1 text-[12px] text-(--muted-foreground)">Budget (USD)
          <input className={field} type="number" min="0" step="1" value={budget} onChange={(e) => setBudget(e.target.value)} />
        </label>
      </div>
      <p className="text-[11px] text-(--muted-foreground)">Purchases, legal filings, destructive changes and credential changes wait for your approval unless you have delegated that authority in <a className="underline" href="/autonomy">Autonomy</a>. Spending past this budget always asks.</p>
      <Button type="submit" size="sm" disabled={disabled || !goal.trim() || !workspaceId}>Plan and start</Button>
    </form>
  );
}

function DetailView({ detail, busy, act }: { detail: Detail; busy: boolean; act(fn: () => Promise<unknown>): void }) {
  const { objective, steps, events } = detail;
  const control = (action: string, stepKey?: string) => act(() => send(`/api/objectives/${objective.id}/control`, "POST", { action, stepKey }));
  const decide = (approvalId: string, status: "approved" | "rejected") => act(() => send(`/api/approvals/${approvalId}`, "PATCH", { status }));
  const titles = useMemo(() => new Map(steps.map((s) => [s.key, s.title])), [steps]);
  const active = ["running", "waiting_approval"].includes(objective.status);

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-(--border) bg-(--card) p-4">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 className="font-display text-[18px] font-semibold">{objective.title}</h2>
            <p className="mt-1 text-[13px] text-(--muted-foreground)">{objective.goal}</p>
          </div>
          <div className="flex items-center gap-2">
            <Badge variant={STATUS_VARIANT[objective.status] ?? "secondary"} className="capitalize">{label(objective.status)}</Badge>
            {active ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => control("pause")}><Pause className="mr-1 h-3.5 w-3.5" />Pause</Button> : null}
            {["paused", "blocked", "failed"].includes(objective.status) ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => control("resume")}><Play className="mr-1 h-3.5 w-3.5" />Resume</Button> : null}
            {objective.status !== "stopped" && objective.status !== "completed" ? <Button size="sm" variant="outline" disabled={busy} onClick={() => control("stop")}><Square className="mr-1 h-3.5 w-3.5" />Stop</Button> : null}
          </div>
        </div>
        <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[12px] text-(--muted-foreground)">
          <div>Autonomy <span className="text-(--foreground)">{objective.autonomyLevel} · {AUTONOMY_LABELS[objective.autonomyLevel as AutonomyLevel]}</span></div>
          <div>Spent <span className="font-mono text-(--foreground)">{money(objective.spentCents)}</span> of <span className="font-mono">{money(objective.budgetCents)}</span></div>
          <div>Estimated <span className="font-mono text-(--foreground)">{money(steps.reduce((n, s) => n + s.estimatedCostCents, 0))}</span></div>
        </dl>
        {objective.report?.summary ? <p className="mt-3 text-[13px]">{objective.report.summary}</p> : null}
      </section>

      <section aria-label="Steps" className="overflow-x-auto rounded-lg border border-(--border)">
        <table className="w-full min-w-[760px] border-collapse text-[13px]">
          <thead className="bg-(--card) text-left text-[12px] text-(--muted-foreground)">
            <tr className="border-b border-(--border)"><th className="px-3 py-2 font-medium">Step</th><th className="px-3 py-2 font-medium">Role</th><th className="px-3 py-2 font-medium">Status</th><th className="px-3 py-2 font-medium">Needs</th><th className="px-3 py-2 font-medium" /></tr>
          </thead>
          <tbody>
            {steps.map((s) => (
              <tr key={s.id} className="border-b border-(--border) align-top last:border-0">
                <td className="px-3 py-2.5">
                  <div className="font-medium">{s.title}</div>
                  <div className="mt-0.5 text-[11px] text-(--muted-foreground)">
                    {s.impact !== "read" ? <span className="capitalize">{s.impact}</span> : "read-only"}
                    {s.dependsOn.length ? <> · after {s.dependsOn.length > 3 ? `${s.dependsOn.length} steps` : s.dependsOn.map((d) => titles.get(d) ?? d).join(", ")}</> : null}
                  </div>
                  {s.status === "completed" && s.verification?.checks?.length ? (
                    <div className="mt-1 text-[11px] text-(--status-online)">Verified: {s.verification.checks.filter((c) => c.passed).length}/{s.verification.checks.length} checks</div>
                  ) : null}
                </td>
                <td className="px-3 py-2.5 text-[12px] capitalize text-(--muted-foreground)">{label(s.role)}</td>
                <td className="px-3 py-2.5"><Badge variant={STATUS_VARIANT[s.status] ?? "secondary"} className="capitalize">{label(s.status)}</Badge>{s.attempts > 1 ? <div className="mt-1 font-mono text-[11px] text-(--muted-foreground)">attempt {s.attempts}</div> : null}</td>
                <td className="max-w-[340px] px-3 py-2.5 text-[12px] text-(--muted-foreground)">{s.unblockRequest ?? s.error ?? s.blockedReason ?? "—"}</td>
                <td className="px-3 py-2.5 text-right whitespace-nowrap">
                  {s.status === "waiting_approval" && s.approvalRequestId ? (
                    <span className="inline-flex gap-1.5">
                      <Button size="sm" disabled={busy} onClick={() => decide(s.approvalRequestId!, "approved")}>Approve</Button>
                      <Button size="sm" variant="outline" disabled={busy} onClick={() => decide(s.approvalRequestId!, "rejected")}>Reject</Button>
                    </span>
                  ) : null}
                  {["blocked", "failed", "advised", "cancelled"].includes(s.status) && objective.status !== "stopped" ? (
                    <Button size="sm" variant="ghost" disabled={busy} onClick={() => control("retry_step", s.key)}><RotateCcw className="mr-1 h-3.5 w-3.5" />Retry</Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section aria-label="Activity" className="rounded-lg border border-(--border) bg-(--card) p-4">
        <h3 className="mb-2 text-[14px] font-semibold">Activity</h3>
        <ol className="max-h-80 space-y-1.5 overflow-y-auto text-[12px]">
          {events.map((e) => (
            <li key={e.id} className="flex gap-3">
              <time className="shrink-0 font-mono text-[11px] text-(--muted-foreground)">{new Date(e.createdAt).toLocaleTimeString()}</time>
              <span>{e.message}</span>
            </li>
          ))}
        </ol>
      </section>
    </div>
  );
}
