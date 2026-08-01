"use client";

import { useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";
import { EmptyState, ErrorBanner, LevelBadge, LoadingState, readApiError, secondaryButtonClass, SectionHeader, StatusBadge } from "./LearningCoreViewShared";

interface QueueRow { id: string; title?: string; name?: string; type?: string; status: string; approvalLevel: number; problem?: string; description?: string; hypothesis?: { title: string } | null }
interface QueuePayload { hypotheses: QueueRow[]; experiments: QueueRow[]; skills: QueueRow[] }

export function ImprovementQueueView() {
  const [payload, setPayload] = useState<QueuePayload>({ hypotheses: [], experiments: [], skills: [] });
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function load() {
    const response = await fetch("/api/learning-core/improvement-queue");
    if (!response.ok) throw new Error(await readApiError(response));
    setPayload(await response.json());
  }

  useEffect(() => {
    fetch("/api/learning-core/improvement-queue")
      .then(async (response) => {
        if (!response.ok) throw new Error(await readApiError(response));
        return response.json();
      })
      .then(setPayload)
      .catch((cause) => setError(cause instanceof Error ? cause.message : "Unable to load improvement queue"))
      .finally(() => setLoaded(true));
  }, []);

  async function decide(type: "hypothesis" | "experiment" | "skill", id: string, decision: "approve" | "reject") {
    setBusy(id);
    setError(null);
    const response = await fetch("/api/learning-core/improvement-queue", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ type, id, decision }) });
    setBusy(null);
    if (!response.ok) return setError(await readApiError(response));
    await load();
  }

  const groups = [
    { type: "hypothesis" as const, label: "Hypotheses", rows: payload.hypotheses },
    { type: "experiment" as const, label: "Experiments", rows: payload.experiments },
    { type: "skill" as const, label: "Skills", rows: payload.skills },
  ];
  const total = groups.reduce((sum, group) => sum + group.rows.length, 0);

  return (
    <div className="max-w-5xl p-4 sm:p-6">
      <SectionHeader icon={<ClipboardCheck className="h-4 w-4 text-[--primary]" />} title="Improvement Queue" description="Level 2 and 3 changes that crossed into human review. Every decision is explicit and written to the evolution timeline." />
      <ErrorBanner message={error} />
      {!loaded ? <LoadingState /> : total === 0 ? <EmptyState>No improvements are waiting for approval.</EmptyState> : groups.map((group) => group.rows.length > 0 && (
        <section key={group.type} className="mb-6"><h2 className="mb-2 text-xs font-semibold text-[--foreground]">{group.label} <span className="text-[--muted-foreground]">({group.rows.length})</span></h2><div className="space-y-2">{group.rows.map((row) => (
          <article key={row.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
            <div className="flex flex-wrap items-center gap-2"><h3 className="mr-auto text-sm font-medium capitalize text-[--foreground]">{row.title ?? row.name ?? row.type?.replaceAll("_", " ")}</h3><LevelBadge level={row.approvalLevel} /><StatusBadge status={row.status} /></div>
            <p className="mt-1 text-xs text-[--muted-foreground]">{row.problem ?? row.description ?? (row.hypothesis ? `Hypothesis: ${row.hypothesis.title}` : "Ready for governance review")}</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row"><button disabled={busy === row.id} className={`${secondaryButtonClass} w-full border-emerald-500/30 text-emerald-400 sm:w-auto`} onClick={() => decide(group.type, row.id, "approve")}>Approve</button><button disabled={busy === row.id} className={`${secondaryButtonClass} w-full border-red-500/30 text-red-400 sm:w-auto`} onClick={() => decide(group.type, row.id, "reject")}>Reject</button></div>
          </article>
        ))}</div></section>
      ))}
    </div>
  );
}
