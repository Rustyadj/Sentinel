"use client";

import { useEffect, useState } from "react";
import { BarChart3, Plus, Trash2, TrendingDown, TrendingUp } from "lucide-react";
import { buttonClass, EmptyState, ErrorBanner, inputClass, LoadingState, readApiError, secondaryButtonClass, SectionHeader } from "./LearningCoreViewShared";

interface BenchmarkRow {
  id: string;
  name: string;
  metric: string;
  value: number;
  baselineValue: number | null;
  comparison: { delta: number; percentChange: number | null } | null;
  experiment: { id: string; type: string; version: string; status: string } | null;
}

interface ExperimentOption { id: string; type: string; version: string }

export function BenchmarksView() {
  const [rows, setRows] = useState<BenchmarkRow[]>([]);
  const [experiments, setExperiments] = useState<ExperimentOption[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/learning-core/benchmarks");
    if (!response.ok) throw new Error(await readApiError(response));
    setRows(await response.json());
  }

  useEffect(() => {
    Promise.all([fetch("/api/learning-core/benchmarks"), fetch("/api/learning-core/experiments")])
      .then(async ([benchmarkResponse, experimentResponse]) => {
        if (!benchmarkResponse.ok) throw new Error(await readApiError(benchmarkResponse));
        if (!experimentResponse.ok) throw new Error(await readApiError(experimentResponse));
        const [benchmarkData, experimentData] = await Promise.all([benchmarkResponse.json(), experimentResponse.json()]);
        setRows(benchmarkData);
        setExperiments(experimentData);
      })
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load benchmarks"))
      .finally(() => setLoaded(true));
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const baseline = String(data.get("baselineValue") ?? "");
    const response = await fetch("/api/learning-core/benchmarks", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: data.get("name"), metric: data.get("metric"), value: Number(data.get("value")), baselineValue: baseline ? Number(baseline) : undefined, experimentId: data.get("experimentId") || undefined }),
    });
    if (!response.ok) return setError(await readApiError(response));
    form.reset();
    await load();
  }

  async function remove(id: string) {
    const response = await fetch(`/api/learning-core/benchmarks/${id}`, { method: "DELETE" });
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  return (
    <div className="max-w-5xl p-6">
      <SectionHeader icon={<BarChart3 className="h-4 w-4 text-[--primary]" />} title="Benchmarks" description="Record experiment measurements beside their baselines. Direction is shown, but promotion remains explicit because not every metric is higher-is-better." />
      <ErrorBanner message={error} />
      <form onSubmit={create} className="mb-6 grid gap-2 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 md:grid-cols-2">
        <input name="name" required placeholder="Benchmark name" className={inputClass} /><input name="metric" required placeholder="Metric (accuracy, latency…)" className={inputClass} />
        <input name="value" required type="number" step="any" placeholder="Observed value" className={inputClass} /><input name="baselineValue" type="number" step="any" placeholder="Baseline value (optional)" className={inputClass} />
        <select name="experimentId" className={`${inputClass} md:col-span-2`} defaultValue=""><option value="">No experiment</option>{experiments.map((row) => <option key={row.id} value={row.id}>{row.type} v{row.version}</option>)}</select>
        <button className={`${buttonClass} md:col-span-2 flex items-center justify-center gap-1.5`}><Plus className="h-3.5 w-3.5" />Record benchmark</button>
      </form>
      {!loaded ? <LoadingState /> : rows.length === 0 ? <EmptyState>No benchmarks recorded.</EmptyState> : (
        <div className="grid gap-3 md:grid-cols-2">{rows.map((row) => (
          <article key={row.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
            <div className="flex items-start justify-between gap-3"><div><h2 className="text-sm font-medium text-[--foreground]">{row.name}</h2><p className="text-[11px] text-[--muted-foreground]">{row.metric}{row.experiment ? ` · ${row.experiment.type} v${row.experiment.version}` : ""}</p></div><button aria-label={`Delete ${row.name}`} className={secondaryButtonClass} onClick={() => remove(row.id)}><Trash2 className="h-3 w-3" /></button></div>
            <div className="mt-4 flex items-end gap-3"><span className="text-2xl font-semibold text-[--foreground]">{row.value}</span>{row.comparison && <span className={`mb-1 flex items-center gap-1 text-xs ${row.comparison.delta >= 0 ? "text-emerald-400" : "text-red-400"}`}>{row.comparison.delta >= 0 ? <TrendingUp className="h-3.5 w-3.5" /> : <TrendingDown className="h-3.5 w-3.5" />}{row.comparison.delta >= 0 ? "+" : ""}{row.comparison.delta.toFixed(2)}{row.comparison.percentChange !== null ? ` (${row.comparison.percentChange.toFixed(1)}%)` : ""}</span>}</div>
            <p className="mt-1 text-[10px] text-[--muted-foreground]">Baseline: {row.baselineValue ?? "not set"}</p>
          </article>
        ))}</div>
      )}
    </div>
  );
}
