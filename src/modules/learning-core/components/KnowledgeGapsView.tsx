"use client";

import { useEffect, useState } from "react";
import { BookOpen, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KnowledgeGap } from "../types";

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-[--muted-foreground]/10 text-[--muted-foreground]",
};

const STATUS_OPTIONS = ["open", "learning", "resolved"] as const;

export function KnowledgeGapsView() {
  const [gaps, setGaps] = useState<KnowledgeGap[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [statusFilter, setStatusFilter] = useState<string>("open");
  const [updatingId, setUpdatingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/learning-core/knowledge-gaps${statusFilter ? `?status=${statusFilter}` : ""}`)
      .then((r) => r.json())
      .then(setGaps)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [statusFilter]);

  async function updateStatus(id: string, status: (typeof STATUS_OPTIONS)[number]) {
    setUpdatingId(id);
    const res = await fetch(`/api/learning-core/knowledge-gaps/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    setUpdatingId(null);
    if (!res.ok) return;
    setGaps((prev) => prev.filter((g) => g.id !== id || !statusFilter || status === statusFilter));
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-[--foreground] flex items-center gap-2">
          <BookOpen className="w-4 h-4 text-[--primary]" /> Knowledge Gaps
        </h1>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="text-xs bg-[--card] border border-[--sidebar-border] rounded-md px-2 py-1 text-[--foreground]"
        >
          <option value="">All</option>
          {STATUS_OPTIONS.map((s) => (
            <option key={s} value={s}>
              {s[0].toUpperCase() + s.slice(1)}
            </option>
          ))}
        </select>
      </div>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Topics agents repeatedly answer with low confidence. Each occurrence sharpens the
        priority — high-priority gaps are candidates for a Hypothesis (see Hypotheses).
      </p>

      {!loaded ? (
        <div className="flex items-center gap-2 text-xs text-[--muted-foreground]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : gaps.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No knowledge gaps in this view.
        </div>
      ) : (
        <div className="space-y-2">
          {gaps.map((gap) => (
            <div
              key={gap.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-[--sidebar-border] bg-[--card] p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {gap.agent && (
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0"
                      style={{ backgroundColor: gap.agent.color + "22" }}
                    >
                      {gap.agent.avatar}
                    </span>
                  )}
                  <span className="text-sm font-medium text-[--foreground] truncate">{gap.topic}</span>
                  <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide", PRIORITY_STYLES[gap.priority])}>
                    {gap.priority}
                  </span>
                  <span className="text-[10px] text-[--muted-foreground]">×{gap.occurrenceCount}</span>
                </div>
                <p className="text-xs text-[--muted-foreground]">{gap.description}</p>
                {gap.estimatedBenefit && (
                  <p className="text-[10px] text-[--muted-foreground] mt-1">Benefit: {gap.estimatedBenefit}</p>
                )}
              </div>
              <select
                value={gap.status}
                disabled={updatingId === gap.id}
                onChange={(e) => updateStatus(gap.id, e.target.value as (typeof STATUS_OPTIONS)[number])}
                className="shrink-0 text-xs bg-transparent border border-[--sidebar-border] rounded-md px-2 py-1 text-[--muted-foreground]"
              >
                {STATUS_OPTIONS.map((s) => (
                  <option key={s} value={s}>
                    {s[0].toUpperCase() + s.slice(1)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
