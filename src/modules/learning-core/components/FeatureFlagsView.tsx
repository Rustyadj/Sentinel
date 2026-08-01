"use client";

import { useEffect, useState } from "react";
import { Flag, Plus, Trash2 } from "lucide-react";
import { buttonClass, EmptyState, ErrorBanner, inputClass, LoadingState, readApiError, secondaryButtonClass, SectionHeader, StatusBadge } from "./LearningCoreViewShared";

interface FeatureFlagRow { id: string; key: string; enabled: boolean; scope: string; scopeId: string | null; rolloutPercentage: number; autoRollbackThreshold: number | null }

export function FeatureFlagsView() {
  const [rows, setRows] = useState<FeatureFlagRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/learning-core/feature-flags");
    if (!response.ok) throw new Error(await readApiError(response));
    setRows(await response.json());
  }

  useEffect(() => {
    fetch("/api/learning-core/feature-flags")
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        return response.json();
      })
      .then(setRows)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load feature flags"))
      .finally(() => setLoaded(true));
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const scope = String(data.get("scope"));
    const threshold = String(data.get("autoRollbackThreshold") ?? "");
    const response = await fetch("/api/learning-core/feature-flags", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ key: data.get("key"), scope, scopeId: scope === "global" ? undefined : data.get("scopeId"), rolloutPercentage: Number(data.get("rolloutPercentage")), autoRollbackThreshold: threshold ? Number(threshold) : undefined }),
    });
    if (!response.ok) return setError(await readApiError(response));
    form.reset();
    await load();
  }

  async function patch(id: string, data: Partial<FeatureFlagRow>) {
    const response = await fetch(`/api/learning-core/feature-flags/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(data) });
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this feature flag?")) return;
    const response = await fetch(`/api/learning-core/feature-flags/${id}`, { method: "DELETE" });
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  return (
    <div className="max-w-5xl p-6">
      <SectionHeader icon={<Flag className="h-4 w-4 text-[--primary]" />} title="Feature Flags" description="Control scoped rollouts and retain an explicit rollback threshold for Level 2 production changes." />
      <ErrorBanner message={error} />
      <form onSubmit={create} className="mb-6 grid gap-2 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 md:grid-cols-2">
        <input name="key" required placeholder="flag.key" className={inputClass} /><select name="scope" className={inputClass} defaultValue="global">{["global", "agent", "workspace", "user", "organization"].map((scope) => <option key={scope}>{scope}</option>)}</select>
        <input name="scopeId" placeholder="Scope ID (non-global)" className={inputClass} /><input name="rolloutPercentage" type="number" min="0" max="100" defaultValue="0" className={inputClass} />
        <input name="autoRollbackThreshold" type="number" step="any" placeholder="Auto-rollback threshold (optional)" className={`${inputClass} md:col-span-2`} />
        <button className={`${buttonClass} md:col-span-2 flex items-center justify-center gap-1.5`}><Plus className="h-3.5 w-3.5" />Create feature flag</button>
      </form>
      {!loaded ? <LoadingState /> : rows.length === 0 ? <EmptyState>No feature flags configured.</EmptyState> : <div className="space-y-2">{rows.map((row) => (
        <article key={row.id} className="flex flex-wrap items-center gap-3 rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
          <button role="switch" aria-checked={row.enabled} onClick={() => patch(row.id, { enabled: !row.enabled })} className={`relative h-5 w-9 rounded-full transition-colors ${row.enabled ? "bg-[--primary]" : "bg-white/10"}`}><span className={`absolute top-0.5 h-4 w-4 rounded-full bg-white transition-transform ${row.enabled ? "left-4.5" : "left-0.5"}`} /></button>
          <div className="min-w-0 flex-1"><h2 className="truncate font-mono text-xs text-[--foreground]">{row.key}</h2><p className="text-[10px] text-[--muted-foreground]">{row.scope}{row.scopeId ? `:${row.scopeId}` : ""} · rollback threshold {row.autoRollbackThreshold ?? "manual"}</p></div>
          <StatusBadge status={`${row.rolloutPercentage}% rollout`} />
          <input aria-label={`${row.key} rollout percentage`} type="number" min="0" max="100" value={row.rolloutPercentage} onChange={(event) => setRows((current) => current.map((item) => item.id === row.id ? { ...item, rolloutPercentage: Number(event.target.value) } : item))} onBlur={(event) => patch(row.id, { rolloutPercentage: Number(event.target.value) })} className="w-16 rounded border border-[--sidebar-border] bg-[--background] px-2 py-1 text-xs text-[--foreground]" />
          <button aria-label={`Delete ${row.key}`} className={secondaryButtonClass} onClick={() => remove(row.id)}><Trash2 className="h-3.5 w-3.5" /></button>
        </article>
      ))}</div>}
    </div>
  );
}
