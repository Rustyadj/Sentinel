"use client";

import { useCallback, useEffect, useState } from "react";
import { BookOpen, RefreshCw } from "lucide-react";

interface KnowledgeGap {
  id: string;
  topic: string;
  description: string;
  source: string | null;
  frequency: number;
  businessImpact: number | null;
  priorityScore: number;
  status: string;
  recommendedAction: string | null;
  updatedAt: string;
}

export function KnowledgeGapsView() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetch("/api/learning/knowledge-gaps")
      .then((response) => {
        if (!response.ok) throw new Error(String(response.status));
        return response.json();
      })
      .then(setGaps)
      .catch(() => setError(true))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function detect() {
    setDetecting(true);
    setError(false);
    try {
      const response = await fetch("/api/learning/knowledge-gaps", { method: "POST" });
      if (!response.ok) throw new Error(String(response.status));
      load();
    } catch {
      setError(true);
    } finally {
      setDetecting(false);
    }
  }

  return (
    <div className="max-w-5xl p-6">
      <div className="mb-6 flex items-start justify-between gap-4">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-semibold text-[--foreground]">
            <BookOpen className="h-4 w-4 text-[--primary]" /> Knowledge Gaps
          </h1>
          <p className="mt-1 max-w-2xl text-sm text-[--muted-foreground]">
            Repeated low-confidence questions and reflection failures, normalized and merged into a
            prioritized research queue.
          </p>
        </div>
        <button
          type="button"
          onClick={detect}
          disabled={detecting}
          className="flex shrink-0 items-center gap-1.5 rounded-md border border-[--sidebar-border] px-3 py-1.5 text-xs text-[--muted-foreground] transition-colors hover:text-[--foreground] disabled:opacity-50"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${detecting ? "animate-spin" : ""}`} />
          {detecting ? "Scanning…" : "Scan recent evidence"}
        </button>
      </div>

      {error ? <p className="mb-3 text-xs text-red-400">Could not load or scan knowledge gaps.</p> : null}
      {!loaded ? (
        <p className="text-xs text-[--muted-foreground]">Loading…</p>
      ) : gaps.length === 0 ? (
        <div className="rounded-lg border border-dashed border-[--sidebar-border] p-6 text-center text-xs text-[--muted-foreground]">
          No repeated knowledge gaps detected yet.
        </div>
      ) : (
        <div className="space-y-2">
          {gaps.map((gap) => (
            <article key={gap.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
              <div className="flex items-start gap-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <h2 className="text-sm font-medium capitalize text-[--foreground]">{gap.topic}</h2>
                    <span className="rounded-full bg-white/5 px-1.5 py-0.5 text-[10px] text-[--muted-foreground]">
                      {gap.status}
                    </span>
                    <span className="text-[10px] text-[--muted-foreground]">seen {gap.frequency}×</span>
                  </div>
                  <p className="mt-1 text-xs text-[--muted-foreground]">{gap.description}</p>
                  {gap.recommendedAction ? (
                    <p className="mt-2 text-xs text-indigo-400">{gap.recommendedAction}</p>
                  ) : null}
                  <div className="mt-2 text-[10px] text-[--muted-foreground]">
                    {gap.source?.replaceAll(",", " + ") ?? "unknown source"}
                    {gap.businessImpact != null ? ` · impact ${gap.businessImpact.toFixed(2)}` : ""}
                  </div>
                </div>
                <div className="w-24 shrink-0 text-right">
                  <div className="text-xs font-medium text-[--foreground]">{gap.priorityScore.toFixed(3)}</div>
                  <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-white/5">
                    <div
                      className="h-full rounded-full bg-[--primary]"
                      style={{ width: `${Math.round(gap.priorityScore * 100)}%` }}
                    />
                  </div>
                  <span className="text-[10px] text-[--muted-foreground]">priority</span>
                </div>
              </div>
            </article>
          ))}
        </div>
      )}
    </div>
  );
}
