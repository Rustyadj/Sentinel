"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { Activity, AlertTriangle, Bot, Brain, Check, GitBranch, History,
  KeyRound, Network, RefreshCw, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

type View = "neural" | "queue" | "retrieval" | "sources" | "memory" | "skills" |
  "contradictions" | "timeline" | "graph" | "agents" | "workflows" | "mcp";
type RecordRow = Record<string, unknown> & { id: string };

const NAV: Array<{ id: View; label: string; icon: typeof Brain }> = [
  { id: "neural", label: "Neural Lens", icon: Brain },
  { id: "queue", label: "Learning Queue", icon: Sparkles },
  { id: "retrieval", label: "Retrieval Trace", icon: Search },
  { id: "sources", label: "Sources", icon: ShieldCheck },
  { id: "memory", label: "Memory Candidates", icon: Brain },
  { id: "skills", label: "Skill Candidates", icon: GitBranch },
  { id: "contradictions", label: "Contradictions", icon: AlertTriangle },
  { id: "timeline", label: "Timeline", icon: History },
  { id: "graph", label: "Graph Inspector", icon: Network },
  { id: "agents", label: "Agent Profiles", icon: Bot },
  { id: "workflows", label: "Workflow Health", icon: Activity },
  { id: "mcp", label: "MCP Clients", icon: KeyRound },
];

const API: Partial<Record<View, string>> = {
  memory: "/api/adaptive-memory/candidates",
  skills: "/api/adaptive-memory/skills/candidates",
  sources: "/api/adaptive-memory/sources",
  contradictions: "/api/adaptive-memory/contradictions",
  mcp: "/api/mcp/clients",
};

function State({ children, tone = "neutral" }: { children: React.ReactNode; tone?: "neutral" | "error" }) {
  return <div className={cn("rounded-xl border p-5 text-sm", tone === "error" ? "border-red-400/20 bg-red-400/5 text-red-200" : "border-white/10 bg-white/[0.025] text-slate-400")}>{children}</div>;
}

function Badge({ value }: { value: unknown }) {
  const label = String(value ?? "unavailable");
  const positive = ["approved", "active", "completed", "auto_approved", "passed"].includes(label);
  const warning = ["pending", "proposed", "testing", "pending_review", "quarantined", "degraded"].includes(label);
  return <span className={cn("rounded-full border px-2 py-0.5 text-[10px] uppercase tracking-wide",
    positive ? "border-emerald-400/25 bg-emerald-400/10 text-emerald-300" : warning ? "border-amber-400/25 bg-amber-400/10 text-amber-200" : "border-slate-500/30 text-slate-400")}>{label}</span>;
}

export function AdaptiveKnowledgePage() {
  const [view, setView] = useState<View>("queue");
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<RecordRow | null>(null);
  const [traceId, setTraceId] = useState("");
  const [trace, setTrace] = useState<RecordRow | null>(null);
  const [workspaceId, setWorkspaceId] = useState("");

  const load = useCallback(async (nextView = view) => {
    const endpoint = API[nextView];
    setSelected(null); setError(null);
    if (!endpoint) { setRows([]); return; }
    setLoading(true);
    try {
      const query = workspaceId ? `${endpoint}?workspaceId=${encodeURIComponent(workspaceId)}` : endpoint;
      const response = await fetch(query, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error ?? "Data source unavailable.");
      setRows(Array.isArray(data) ? data : []);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "Data source unavailable."); setRows([]); }
    finally { setLoading(false); }
  }, [view, workspaceId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);
  useEffect(() => {
    const listener = (event: Event) => {
      const tab = (event as CustomEvent<{ tabId?: string }>).detail?.tabId as View | undefined;
      if (tab && NAV.some((item) => item.id === tab)) setView(tab);
    };
    window.addEventListener("sentinel:module-tab", listener);
    return () => window.removeEventListener("sentinel:module-tab", listener);
  }, []);

  const review = async (kind: "memory" | "skills", id: string, decision: "approve" | "reject") => {
    const endpoint = kind === "memory" ? `/api/adaptive-memory/candidates/${id}/review` : `/api/adaptive-memory/skills/candidates/${id}/review`;
    setError(null);
    const response = await fetch(endpoint, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ decision, note: "Reviewed in Knowledge Governance." }) });
    const data = await response.json();
    if (!response.ok) { setError(data.error ?? "Review failed."); return; }
    await load(view);
  };

  const loadTrace = async () => {
    setError(null); setTrace(null); if (!traceId.trim()) return;
    const response = await fetch(`/api/adaptive-memory/retrieval-traces/${encodeURIComponent(traceId.trim())}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) setError(data.error ?? "Trace unavailable."); else setTrace(data);
  };

  return (
    <div className="flex min-h-full flex-col bg-[#050b13] text-slate-100 lg:flex-row">
      <aside className="w-full shrink-0 border-b border-white/[0.07] bg-[#07101b] lg:w-56 lg:border-b-0 lg:border-r">
        <div className="border-b border-white/[0.07] p-4">
          <p className="text-[10px] font-semibold uppercase tracking-[0.18em] text-violet-300">Knowledge Graph</p>
          <p className="mt-1 text-xs text-slate-500">Evidence, recall, and governed learning</p>
        </div>
        <nav aria-label="Knowledge Graph" className="flex gap-1 overflow-x-auto p-2 lg:block lg:space-y-0.5">
          {NAV.map(({ id, label, icon: Icon }) => <button key={id} onClick={() => setView(id)}
            className={cn("flex shrink-0 items-center gap-2 rounded-lg px-3 py-2 text-left text-xs transition-colors lg:w-full",
              view === id ? "bg-violet-500/15 text-violet-200" : "text-slate-500 hover:bg-white/[0.04] hover:text-slate-200")}
            aria-current={view === id ? "page" : undefined}><Icon className="h-3.5 w-3.5" />{label}</button>)}
        </nav>
      </aside>

      <section className="min-w-0 flex-1 p-4 sm:p-6">
        <header className="mb-5 flex flex-wrap items-center gap-3">
          <div><h1 className="text-lg font-semibold">{NAV.find((item) => item.id === view)?.label}</h1>
            <p className="text-xs text-slate-500">Live Sentinel records only. No inferred operational state.</p></div>
          <div className="ml-auto flex items-center gap-2">
            <input value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)} placeholder="Workspace ID (optional)"
              aria-label="Workspace ID" className="h-8 w-48 rounded-lg border border-white/10 bg-black/20 px-3 text-xs outline-none focus:border-violet-400/50" />
            <button onClick={() => void load()} aria-label="Refresh" className="rounded-lg border border-white/10 p-2 text-slate-400 hover:text-white"><RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} /></button>
          </div>
        </header>

        {error ? <State tone="error">{error}</State> : null}
        {view === "neural" || view === "timeline" || view === "graph" ? <State>
          Neural graph state and temporal replay remain in the existing live Neural Lens. <Link className="ml-1 text-violet-300 underline" href="/chat?space=graph">Open Neural Lens</Link>
        </State> : null}
        {view === "retrieval" ? <div className="space-y-4">
          <div className="flex max-w-xl gap-2"><input value={traceId} onChange={(event) => setTraceId(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void loadTrace(); }} placeholder="Retrieval trace ID" className="h-9 flex-1 rounded-lg border border-white/10 bg-black/20 px-3 text-xs outline-none focus:border-violet-400/50" />
            <button onClick={() => void loadTrace()} className="rounded-lg bg-violet-500 px-4 text-xs font-medium">Inspect</button></div>
          {trace ? <RecordInspector record={trace} /> : <State>Enter a trace ID from a context build. Scores, exclusions, prompt inclusion, token cost, and the frozen run snapshot remain attributable.</State>}
        </div> : null}
        {view === "queue" ? <LearningQueue workspaceId={workspaceId} onError={setError} /> : null}
        {view === "agents" ? <AgentProfiles workspaceId={workspaceId} /> : null}
        {view === "workflows" ? <WorkflowHealth workspaceId={workspaceId} /> : null}
        {API[view] ? <div className="mt-4 grid gap-3 xl:grid-cols-[minmax(0,1fr)_minmax(300px,0.55fr)]">
          <div className="space-y-2">{loading ? <State>Loading live records…</State> : rows.length === 0 ? <State>No records are available for this scope.</State> : rows.map((row) =>
            <button key={row.id} onClick={() => setSelected(row)} className="w-full rounded-xl border border-white/[0.08] bg-white/[0.025] p-4 text-left hover:border-violet-400/30">
              <div className="flex items-start gap-3"><div className="min-w-0 flex-1"><p className="truncate text-sm font-medium">{String(row.name ?? row.title ?? row.content ?? row.sourceSystem ?? row.id).slice(0, 140)}</p>
                <p className="mt-1 line-clamp-2 text-xs text-slate-500">{String(row.description ?? row.purpose ?? row.sourceUri ?? row.candidateType ?? "Persisted record")}</p></div><Badge value={row.status} /></div>
              {((view === "memory" || view === "skills") && ["pending", "quarantined", "pending_review"].includes(String(row.status))) ? <div className="mt-3 flex gap-2">
                <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); void review(view, row.id, "approve"); }} className="flex items-center gap-1 rounded-md bg-emerald-500/15 px-2 py-1 text-[10px] text-emerald-300"><Check className="h-3 w-3" />Approve</span>
                <span role="button" tabIndex={0} onClick={(event) => { event.stopPropagation(); void review(view, row.id, "reject"); }} className="flex items-center gap-1 rounded-md bg-red-500/10 px-2 py-1 text-[10px] text-red-300"><X className="h-3 w-3" />Reject</span></div> : null}
            </button>)}</div>
          <div>{selected ? <RecordInspector record={selected} /> : <State>Select a record to inspect provenance, review history, versions, replay evidence, and rollback metadata.</State>}</div>
        </div> : null}
      </section>
    </div>
  );
}

function RecordInspector({ record }: { record: RecordRow }) {
  return <div className="sticky top-4 rounded-xl border border-white/[0.08] bg-[#08121f] p-4"><h2 className="text-xs font-semibold uppercase tracking-wider text-violet-300">Inspector</h2>
    <pre className="mt-3 max-h-[65vh] overflow-auto whitespace-pre-wrap break-words text-[11px] leading-5 text-slate-400">{JSON.stringify(record, null, 2)}</pre></div>;
}

function LearningQueue({ workspaceId, onError }: { workspaceId: string; onError: (message: string | null) => void }) {
  const [counts, setCounts] = useState<{ memory: number; skills: number } | null>(null);
  useEffect(() => { const suffix = workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "";
    Promise.all([fetch(`/api/adaptive-memory/candidates${suffix}`).then((r) => r.ok ? r.json() : Promise.reject(new Error("Memory queue unavailable."))), fetch(`/api/adaptive-memory/skills/candidates${suffix}`).then((r) => r.ok ? r.json() : Promise.reject(new Error("Skill queue unavailable.")))])
      .then(([memory, skills]) => setCounts({ memory: memory.filter((item: RecordRow) => ["pending", "quarantined"].includes(String(item.status))).length, skills: skills.filter((item: RecordRow) => ["testing", "pending_review", "degraded"].includes(String(item.status))).length }))
      .catch((error) => onError(error.message));
  }, [workspaceId, onError]);
  return counts ? <div className="grid gap-3 sm:grid-cols-2"><State>{counts.memory} memory candidate(s) need attention.</State><State>{counts.skills} skill candidate(s) are testing, awaiting review, or degraded.</State></div> : <State>Loading review queues…</State>;
}

function AgentProfiles({ workspaceId }: { workspaceId: string }) {
  return <State>{workspaceId ? "Agent profiles are available through the scoped agent APIs; select an agent from the Agents module to inspect evidence-derived competencies." : "Enter a workspace ID to inspect workspace-scoped agent profiles. Sentinel does not infer an active workspace from browser state."}</State>;
}

function WorkflowHealth({ workspaceId }: { workspaceId: string }) {
  const [data, setData] = useState<RecordRow[] | null>(null); const [error, setError] = useState<string | null>(null);
  useEffect(() => { if (!workspaceId) return; const controller = new AbortController();
    fetch(`/api/adaptive-memory/workflows/health?workspaceId=${encodeURIComponent(workspaceId)}`, { cache: "no-store", signal: controller.signal }).then(async (response) => { const body = await response.json(); if (!response.ok) throw new Error(body.error); setData(body); setError(null); }).catch((reason) => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort(); }, [workspaceId]);
  if (!workspaceId) return <State>Enter a workspace ID. Workflow health is unavailable without an explicit authorized scope.</State>;
  if (error) return <State tone="error">{error}</State>;
  if (!data) return <State>Loading persisted workflow runs…</State>;
  if (!data.length) return <State>No recurring workflows have persisted health data in this workspace.</State>;
  return <div className="space-y-2">{data.map((row) => <RecordInspector key={row.id} record={row} />)}</div>;
}
