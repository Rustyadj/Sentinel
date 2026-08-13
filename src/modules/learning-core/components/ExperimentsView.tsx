"use client";

import { useEffect, useState } from "react";
import { Beaker, Plus, Trash2 } from "lucide-react";
import { buttonClass, EmptyState, ErrorBanner, inputClass, LevelBadge, LoadingState, readApiError, secondaryButtonClass, SectionHeader, StatusBadge } from "./LearningCoreViewShared";

interface ExperimentRow {
  id: string;
  type: string;
  version: string;
  status: string;
  approvalLevel: number;
  metrics: unknown;
  hypothesis: { id: string; title: string } | null;
  benchmarks: unknown[];
}

interface HypothesisOption { id: string; title: string }

const NEXT_STATUS: Record<string, string> = { shadow: "running", running: "completed" };

export function ExperimentsView() {
  const [rows, setRows] = useState<ExperimentRow[]>([]);
  const [hypotheses, setHypotheses] = useState<HypothesisOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/learning-core/experiments");
    if (!response.ok) throw new Error(await readApiError(response));
    setRows(await response.json());
  }

  useEffect(() => {
    Promise.all([fetch("/api/learning-core/experiments"), fetch("/api/learning-core/hypotheses")])
      .then(async ([experimentsResponse, hypothesesResponse]) => {
        if (!experimentsResponse.ok) throw new Error(await readApiError(experimentsResponse));
        if (!hypothesesResponse.ok) throw new Error(await readApiError(hypothesesResponse));
        const [experimentsData, hypothesesData] = await Promise.all([experimentsResponse.json(), hypothesesResponse.json()]);
        setRows(experimentsData);
        setHypotheses(hypothesesData);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load experiments"))
      .finally(() => setLoaded(true));
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    let metrics: unknown = {};
    try { metrics = JSON.parse(String(data.get("metrics") || "{}")); } catch { setSaving(false); return setError("Metrics must be valid JSON"); }
    const response = await fetch("/api/learning-core/experiments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: data.get("type"), version: data.get("version"), hypothesisId: data.get("hypothesisId") || undefined, metrics }),
    });
    setSaving(false);
    if (!response.ok) return setError(await readApiError(response));
    form.reset();
    await load();
  }

  async function patch(id: string, status: string) {
    const response = await fetch(`/api/learning-core/experiments/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this experiment?")) return;
    const response = await fetch(`/api/learning-core/experiments/${id}`, { method: "DELETE" });
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  return (
    <div className="max-w-5xl p-6">
      <SectionHeader icon={<Beaker className="h-4 w-4 text-[--primary]" />} title="Experiments" description="Run improvements in shadow mode, capture metrics, and promote only through the documented trust and approval gates." />
      <ErrorBanner message={error} />
      <form onSubmit={create} className="mb-6 grid gap-2 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 md:grid-cols-2">
        <select name="type" className={inputClass} defaultValue="prompt">{["prompt", "retrieval", "memory", "planning", "reasoning", "tool_selection", "workflow", "graph_ranking", "model_routing", "skill", "cost_optimization", "ui_behavior"].map((type) => <option key={type} value={type}>{type.replaceAll("_", " ")}</option>)}</select>
        <input name="version" defaultValue="1.0.0" required className={inputClass} />
        <select name="hypothesisId" className={inputClass} defaultValue=""><option value="">Standalone (defaults to Level 2)</option>{hypotheses.map((row) => <option key={row.id} value={row.id}>{row.title}</option>)}</select>
        <input name="metrics" defaultValue="{}" aria-label="Metrics JSON" className={inputClass} />
        <button disabled={saving} className={`${buttonClass} md:col-span-2 flex items-center justify-center gap-1.5`}><Plus className="h-3.5 w-3.5" />{saving ? "Creating…" : "Create shadow experiment"}</button>
      </form>
      {!loaded ? <LoadingState /> : rows.length === 0 ? <EmptyState>No experiments yet.</EmptyState> : (
        <div className="space-y-2">{rows.map((row) => (
          <article key={row.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
            <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm font-medium capitalize text-[--foreground]">{row.type.replaceAll("_", " ")} v{row.version}</h2><LevelBadge level={row.approvalLevel} /><StatusBadge status={row.status} /></div>
            <p className="mt-2 text-xs text-[--muted-foreground]">{row.hypothesis ? `Hypothesis: ${row.hypothesis.title}` : "Standalone experiment"} · {row.benchmarks.length} benchmarks</p>
            <pre className="mt-2 overflow-x-auto rounded bg-black/15 p-2 text-[10px] text-[--muted-foreground]">{JSON.stringify(row.metrics, null, 2)}</pre>
            <div className="mt-3 flex gap-2">{NEXT_STATUS[row.status] && <button className={secondaryButtonClass} onClick={() => patch(row.id, NEXT_STATUS[row.status])}>{NEXT_STATUS[row.status] === "running" ? "Start run" : "Mark completed"}</button>}{["shadow", "running", "completed"].includes(row.status) && <button className={secondaryButtonClass} onClick={() => patch(row.id, "discarded")}>Discard</button>}<button aria-label={`Delete ${row.type} experiment`} className={secondaryButtonClass} onClick={() => remove(row.id)}><Trash2 className="h-3.5 w-3.5" /></button></div>
          </article>
        ))}</div>
      )}
    </div>
  );
}
