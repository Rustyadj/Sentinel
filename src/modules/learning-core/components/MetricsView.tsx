"use client";

import { useEffect, useState } from "react";
import { BarChart3, Loader2 } from "lucide-react";
import type { LearningCoreMetrics } from "../types";

function StatCard({ label, value, breakdown }: { label: string; value: number; breakdown?: Record<string, number> }) {
  return (
    <div className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
      <div className="text-2xl font-semibold text-[--foreground]">{value}</div>
      <div className="text-xs text-[--muted-foreground] mt-1">{label}</div>
      {breakdown && Object.keys(breakdown).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(breakdown).map(([key, count]) => (
            <span key={key} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[--muted-foreground]">
              {key.replaceAll("_", " ")}: {count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

function sum(record: Record<string, number>): number {
  return Object.values(record).reduce((a, b) => a + b, 0);
}

export function MetricsView() {
  const [metrics, setMetrics] = useState<LearningCoreMetrics | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/learning-core/metrics")
      .then((r) => r.json())
      .then(setMetrics)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <BarChart3 className="w-4 h-4 text-[--primary]" /> Metrics
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Counts and rates over what&apos;s actually persisted — no invented quality scores for
        things we don&apos;t measure yet.
      </p>

      {!loaded || !metrics ? (
        <div className="flex items-center gap-2 text-xs text-[--muted-foreground]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-6">
          <div>
            <h2 className="text-xs font-semibold text-[--muted-foreground] uppercase tracking-wide mb-2">Observation</h2>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Curiosity events" value={metrics.curiosity.total} />
              <StatCard label="Unresolved questions" value={metrics.curiosity.unresolved} />
              <StatCard label="Knowledge gaps" value={sum(metrics.knowledgeGaps)} breakdown={metrics.knowledgeGaps} />
              <StatCard label="Reflections" value={metrics.reflection.total} />
              <StatCard label="Flagged “should ask more”" value={metrics.reflection.shouldAskMore} />
              <StatCard label="Preferences learned" value={metrics.preferences.total} />
              <StatCard label="Replay entries" value={sum(metrics.replay)} breakdown={metrics.replay} />
            </div>
          </div>
          <div>
            <h2 className="text-xs font-semibold text-[--muted-foreground] uppercase tracking-wide mb-2">Improvement &amp; Governance</h2>
            <div className="grid grid-cols-3 gap-3">
              <StatCard label="Hypotheses" value={sum(metrics.hypotheses)} breakdown={metrics.hypotheses} />
              <StatCard label="Experiments" value={sum(metrics.experiments)} breakdown={metrics.experiments} />
              <StatCard label="Skills" value={metrics.skills.total} />
              <StatCard label="Trust events" value={metrics.trustEvents.total} />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
