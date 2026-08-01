"use client";

import { useEffect, useState } from "react";
import { Library, Plus, Trash2 } from "lucide-react";
import { buttonClass, EmptyState, ErrorBanner, inputClass, LevelBadge, LoadingState, readApiError, secondaryButtonClass, SectionHeader, StatusBadge } from "./LearningCoreViewShared";

interface SkillRow {
  id: string;
  name: string;
  description: string;
  dependencies: string[];
  version: string;
  approvalLevel: number;
  status: string;
}

const NEXT_STATUS: Record<string, string> = { proposed: "testing", approved: "installed" };

export function SkillsView() {
  const [rows, setRows] = useState<SkillRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/learning-core/skills");
    if (!response.ok) throw new Error(await readApiError(response));
    setRows(await response.json());
  }

  useEffect(() => {
    fetch("/api/learning-core/skills")
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        return response.json();
      })
      .then(setRows)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load skills"))
      .finally(() => setLoaded(true));
  }, []);

  async function create(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const response = await fetch("/api/learning-core/skills", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: data.get("name"),
        description: data.get("description"),
        version: data.get("version"),
        approvalLevel: Number(data.get("approvalLevel")),
        dependencies: String(data.get("dependencies") ?? "").split(",").map((value) => value.trim()).filter(Boolean),
      }),
    });
    if (!response.ok) return setError(await readApiError(response));
    form.reset();
    await load();
  }

  async function patch(id: string, status: string) {
    const response = await fetch(`/api/learning-core/skills/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  async function remove(id: string) {
    if (!window.confirm("Delete this skill?")) return;
    const response = await fetch(`/api/learning-core/skills/${id}`, { method: "DELETE" });
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  return (
    <div className="max-w-5xl p-6">
      <SectionHeader icon={<Library className="h-4 w-4 text-[--primary]" />} title="Skill Library" description="Test, approve, and install reusable capabilities. Approval level and agent trust determine whether the next step can be autonomous." />
      <ErrorBanner message={error} />
      <form onSubmit={create} className="mb-6 grid gap-2 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 md:grid-cols-2">
        <input name="name" required placeholder="Skill name" className={inputClass} /><input name="version" required defaultValue="0.1.0" className={inputClass} />
        <textarea name="description" required placeholder="Description" className={inputClass} /><input name="dependencies" placeholder="Dependencies, comma separated" className={inputClass} />
        <select name="approvalLevel" className={`${inputClass} md:col-span-2`} defaultValue="1"><option value="1">Level 1 — auto-deploy when trust allows</option><option value="2">Level 2 — approval after testing</option><option value="3">Level 3 — always human approval</option></select>
        <button className={`${buttonClass} md:col-span-2 flex items-center justify-center gap-1.5`}><Plus className="h-3.5 w-3.5" />Propose skill</button>
      </form>
      {!loaded ? <LoadingState /> : rows.length === 0 ? <EmptyState>No skills proposed.</EmptyState> : (
        <div className="grid gap-3 md:grid-cols-2">{rows.map((row) => (
          <article key={row.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
            <div className="flex flex-wrap items-center gap-2"><h2 className="mr-auto text-sm font-medium text-[--foreground]">{row.name} <span className="text-[10px] text-[--muted-foreground]">v{row.version}</span></h2><LevelBadge level={row.approvalLevel} /><StatusBadge status={row.status} /></div>
            <p className="mt-2 text-xs text-[--muted-foreground]">{row.description}</p>
            <p className="mt-2 text-[10px] text-[--muted-foreground]">Dependencies: {row.dependencies.join(", ") || "none"}</p>
            <div className="mt-3 flex gap-2">{NEXT_STATUS[row.status] && <button className={secondaryButtonClass} onClick={() => patch(row.id, NEXT_STATUS[row.status])}>{NEXT_STATUS[row.status] === "testing" ? "Begin testing" : "Install"}</button>}<button aria-label={`Delete ${row.name}`} className={secondaryButtonClass} onClick={() => remove(row.id)}><Trash2 className="h-3.5 w-3.5" /></button></div>
          </article>
        ))}</div>
      )}
    </div>
  );
}
