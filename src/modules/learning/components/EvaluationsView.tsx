"use client";

import { useCallback, useEffect, useState } from "react";
import { ClipboardCheck } from "lucide-react";

interface EvalSuite {
  id: string;
  name: string;
  category: string;
  status: string;
  createdAt: string;
  _count?: { cases: number };
}

interface EvalCase {
  id: string;
  source: string;
  failureType: string;
  severity: string;
  occurrenceCount: number;
  expectedBehavior: string;
  status: string;
  createdAt: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "bg-red-500/15 text-red-400",
  high: "bg-orange-500/15 text-orange-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-white/5 text-[--muted-foreground]",
};

export function EvaluationsView() {
  const [suites, setSuites] = useState<EvalSuite[]>([]);
  const [cases, setCases] = useState<EvalCase[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback((suiteId?: string) => {
    const qs = suiteId ? `?suiteId=${suiteId}` : "";
    fetch(`/api/learning/evaluations${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setError(null);
        setSuites(data.suites);
        setCases(data.cases);
      })
      .catch(() => setError("Could not load evaluation suites."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <ClipboardCheck className="w-4 h-4 text-[--primary]" /> Evaluations
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Every meaningful production failure — a user correction, a rejected candidate, a rollback, a
        discovered adversarial attack — is compiled into a durable EvalCase and grouped into a suite.
        Every future candidate touching the same surface must run against it.
      </p>

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-400 border border-red-500/20 rounded-lg p-6 text-center">{error}</div>
      ) : suites.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No evaluation suites yet — they are created automatically the first time a production failure is compiled.
        </div>
      ) : (
        <div className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] gap-4">
          <div className="space-y-1.5">
            {suites.map((suite) => (
              <button
                key={suite.id}
                type="button"
                onClick={() => {
                  setSelected(suite.id);
                  load(suite.id);
                }}
                className={`w-full text-left rounded-lg border p-3 transition-colors ${
                  selected === suite.id
                    ? "border-violet-500/50 bg-violet-500/10"
                    : "border-[--sidebar-border] bg-[--card] hover:border-white/20"
                }`}
              >
                <div className="text-sm text-[--foreground]">{suite.name}</div>
                <div className="text-[10px] text-[--muted-foreground] mt-1">
                  {suite.category} · {suite._count?.cases ?? 0} case(s)
                </div>
              </button>
            ))}
          </div>
          <div className="space-y-1.5">
            {selected === null ? (
              <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
                Select a suite to see its regression cases.
              </div>
            ) : cases.length === 0 ? (
              <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
                No cases in this suite yet.
              </div>
            ) : (
              cases.map((c) => (
                <div key={c.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
                  <div className="flex items-center gap-2">
                    <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${SEVERITY_COLOR[c.severity] ?? SEVERITY_COLOR.low}`}>
                      {c.severity}
                    </span>
                    <span className="text-xs text-[--foreground]">{c.failureType}</span>
                    {c.occurrenceCount > 1 && (
                      <span className="text-[10px] text-[--muted-foreground]">×{c.occurrenceCount}</span>
                    )}
                  </div>
                  <p className="text-xs text-[--muted-foreground] mt-1.5">{c.expectedBehavior}</p>
                  <div className="text-[10px] text-[--muted-foreground]/70 mt-1">source: {c.source}</div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
