"use client";

import { useEffect, useState } from "react";
import { FlaskConical, Plus, Trash2 } from "lucide-react";
import {
  buttonClass,
  EmptyState,
  ErrorBanner,
  inputClass,
  LevelBadge,
  LoadingState,
  readApiError,
  secondaryButtonClass,
  SectionHeader,
  StatusBadge,
} from "./LearningCoreViewShared";

interface HypothesisRow {
  id: string;
  title: string;
  problem: string;
  expectedImprovement: string;
  risk: string;
  affectedSystems: string[];
  rollbackPlan: string;
  successCriteria: string;
  status: string;
  approvalLevel: number;
  _count: { experiments: number };
}

export function HypothesesView() {
  const [rows, setRows] = useState<HypothesisRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/learning-core/hypotheses");
    if (!response.ok) throw new Error(await readApiError(response));
    setRows(await response.json());
  }

  useEffect(() => {
    fetch("/api/learning-core/hypotheses")
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        return response.json();
      })
      .then(setRows)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load hypotheses"))
      .finally(() => setLoaded(true));
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/learning-core/hypotheses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: data.get("title"),
        problem: data.get("problem"),
        rootCause: data.get("rootCause") || undefined,
        expectedImprovement: data.get("expectedImprovement"),
        risk: data.get("risk"),
        affectedSystems: String(data.get("affectedSystems") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
        rollbackPlan: data.get("rollbackPlan"),
        successCriteria: data.get("successCriteria"),
      }),
    });
    setSaving(false);
    if (!response.ok) return setError(await readApiError(response));
    form.reset();
    await load();
  }

  async function patch(id: string, status: string) {
    const response = await fetch(`/api/learning-core/hypotheses/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this hypothesis?")) return;
    const response = await fetch(`/api/learning-core/hypotheses/${id}`, { method: "DELETE" });
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  return (
    <div className="max-w-5xl p-6">
      <SectionHeader icon={<FlaskConical className="h-4 w-4 text-[--primary]" />} title="Hypotheses" description="Frame measurable, reversible improvements. Risk and affected systems determine the immutable approval floor." />
      <ErrorBanner message={error} />
      <form onSubmit={create} className="mb-6 grid gap-2 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 md:grid-cols-2">
        <input name="title" required placeholder="Hypothesis title" className={inputClass} />
        <select name="risk" className={inputClass} defaultValue="low"><option value="low">Low risk</option><option value="medium">Medium risk</option><option value="high">High risk</option></select>
        <textarea name="problem" required placeholder="Problem" className={inputClass} />
        <textarea name="rootCause" placeholder="Root cause (optional)" className={inputClass} />
        <textarea name="expectedImprovement" required placeholder="Expected improvement" className={inputClass} />
        <input name="affectedSystems" placeholder="Affected systems, comma separated" className={inputClass} />
        <textarea name="rollbackPlan" required placeholder="Rollback plan" className={inputClass} />
        <textarea name="successCriteria" required placeholder="Success criteria" className={inputClass} />
        <button disabled={saving} className={`${buttonClass} md:col-span-2 flex items-center justify-center gap-1.5`}><Plus className="h-3.5 w-3.5" />{saving ? "Creating…" : "Create hypothesis"}</button>
      </form>
      {!loaded ? <LoadingState /> : rows.length === 0 ? <EmptyState>No hypotheses yet.</EmptyState> : (
        <div className="space-y-2">{rows.map((row) => (
          <article key={row.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm font-medium text-[--foreground]">{row.title}</h2><LevelBadge level={row.approvalLevel} /><StatusBadge status={row.status} /></div>
            <p className="text-xs text-[--muted-foreground]">{row.problem}</p>
            <div className="mt-3 grid gap-2 text-[11px] text-[--muted-foreground] md:grid-cols-3"><span>Risk: <b className="text-[--foreground]">{row.risk}</b></span><span>{row._count.experiments} experiments</span><span>{row.affectedSystems.join(", ") || "No systems tagged"}</span></div>
            <div className="mt-3 flex gap-2">{row.status === "draft" && <button className={secondaryButtonClass} onClick={() => patch(row.id, "testing")}>Start testing</button>}<button aria-label={`Delete ${row.title}`} className={secondaryButtonClass} onClick={() => remove(row.id)}><Trash2 className="h-3.5 w-3.5" /></button></div>
          </article>
        ))}</div>
      )}
    </div>
  );
}
