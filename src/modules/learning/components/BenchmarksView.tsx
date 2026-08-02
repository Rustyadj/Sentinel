"use client";

import { useCallback, useEffect, useState } from "react";
import { Gauge } from "lucide-react";

interface BenchmarkDefinition {
  id: string;
  name: string;
  category: string;
  scoringMethod: string;
  enabled: boolean;
  createdAt: string;
}

interface BenchmarkResult {
  id: string;
  candidateId: string | null;
  overallScore: number | null;
  accuracy: number | null;
  latency: number | null;
  cost: number | null;
  safetyViolations: number;
  createdAt: string;
}

function ResultsPanel({ benchmarkId }: { benchmarkId: string }) {
  const [results, setResults] = useState<BenchmarkResult[] | null>(null);

  useEffect(() => {
    fetch(`/api/learning/benchmarks/${benchmarkId}/results`)
      .then((r) => r.json())
      .then(setResults)
      .catch(() => setResults([]));
  }, [benchmarkId]);

  if (results === null) return <p className="text-xs text-[--muted-foreground] pl-6">Loading results…</p>;
  if (results.length === 0) return <p className="text-xs text-[--muted-foreground] pl-6">No runs recorded yet.</p>;

  return (
    <div className="pl-6 space-y-1.5">
      {results.map((r) => (
        <div key={r.id} className="flex items-center gap-2 text-xs">
          <span className={r.candidateId ? "text-[--foreground]" : "text-[--muted-foreground] italic"}>
            {r.candidateId ? `candidate ${r.candidateId.slice(0, 8)}` : "baseline"}
          </span>
          <span className="text-[10px] text-[--muted-foreground]">
            score {r.overallScore?.toFixed(2) ?? "—"}
          </span>
          {r.accuracy !== null && <span className="text-[10px] text-[--muted-foreground]">acc {r.accuracy.toFixed(2)}</span>}
          {r.safetyViolations > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-red-500/15 text-red-400">
              {r.safetyViolations} safety violation(s)
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

export function BenchmarksView() {
  const [definitions, setDefinitions] = useState<BenchmarkDefinition[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/learning/benchmarks")
      .then((r) => r.json())
      .then(setDefinitions)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Gauge className="w-4 h-4 text-[--primary]" /> Benchmarks
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Baseline vs. candidate, with hard guardrails (accuracy regression, safety violations,
        cost/latency ceilings) that gate promotion regardless of the blended score — a cheaper but
        less accurate candidate fails, a faster but unsafe one fails.
      </p>

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : definitions.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No benchmark definitions yet.
        </div>
      ) : (
        <div className="space-y-2">
          {definitions.map((def) => {
            const isOpen = expanded === def.id;
            return (
              <div key={def.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
                <button className="flex items-center gap-2 w-full text-left" onClick={() => setExpanded(isOpen ? null : def.id)}>
                  <span className="text-sm text-[--foreground] flex-1 truncate">{def.name}</span>
                  <span className="text-[10px] text-[--muted-foreground]">{def.category}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${def.enabled ? "bg-emerald-500/15 text-emerald-400" : "bg-white/5 text-[--muted-foreground]"}`}>
                    {def.enabled ? "enabled" : "disabled"}
                  </span>
                </button>
                {isOpen && (
                  <div className="mt-2">
                    <ResultsPanel benchmarkId={def.id} />
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
