"use client";

import { useEffect, useState } from "react";
import { GitBranch } from "lucide-react";
import { EmptyState, ErrorBanner, LoadingState, readApiError, SectionHeader, StatusBadge } from "./LearningCoreViewShared";

interface EvolutionRow { id: string; title: string; stage: string; relatedType: string | null; relatedId: string | null; metadata: Record<string, unknown>; createdAt: string }

export function EvolutionView() {
  const [rows, setRows] = useState<EvolutionRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [stage, setStage] = useState("");
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const query = stage ? `?stage=${encodeURIComponent(stage)}` : "";
    fetch(`/api/learning-core/evolution${query}`)
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        return response.json();
      })
      .then(setRows)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load timeline"))
      .finally(() => setLoaded(true));
  }, [stage]);

  return (
    <div className="max-w-4xl p-6">
      <SectionHeader icon={<GitBranch className="h-4 w-4 text-[--primary]" />} title="Evolution Timeline" description="An append-only record of every improvement moving through testing, shadow, approval, production, rollback, or supersession." />
      <ErrorBanner message={error} />
      <div className="mb-5 flex flex-wrap gap-1.5">{["", "created", "testing", "shadow", "approved", "production", "rollback", "superseded"].map((value) => <button key={value || "all"} onClick={() => setStage(value)} className={`rounded-full border px-2.5 py-1 text-[10px] ${stage === value ? "border-[--primary]/50 bg-[--primary]/15 text-[--primary]" : "border-[--sidebar-border] text-[--muted-foreground]"}`}>{value || "all"}</button>)}</div>
      {!loaded ? <LoadingState /> : rows.length === 0 ? <EmptyState>No evolution events for this filter.</EmptyState> : (
        <div className="relative ml-2 border-l border-[--sidebar-border] pl-6">{rows.map((row) => (
          <article key={row.id} className="relative mb-4 rounded-lg border border-[--sidebar-border] bg-[--card] p-4 before:absolute before:-left-[29px] before:top-5 before:h-2.5 before:w-2.5 before:rounded-full before:border-2 before:border-[--background] before:bg-[--primary]">
            <div className="flex items-center gap-2"><h2 className="mr-auto text-sm font-medium text-[--foreground]">{row.title}</h2><StatusBadge status={row.stage} /></div>
            <p className="mt-1 text-[10px] text-[--muted-foreground]">{new Date(row.createdAt).toLocaleString()}{row.relatedType ? ` · ${row.relatedType}:${row.relatedId}` : ""}</p>
          </article>
        ))}</div>
      )}
    </div>
  );
}
