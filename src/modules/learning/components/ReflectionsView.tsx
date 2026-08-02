"use client";

import { useCallback, useEffect, useState } from "react";
import { Brain, HelpCircle, Lightbulb } from "lucide-react";

interface Reflection {
  id: string;
  agentId: string;
  reflectionType: string;
  summary: string;
  whatWorked: string | null;
  whatFailed: string | null;
  unexpectedResults: string | null;
  incorrectAssumptions: string | null;
  missingInformation: string | null;
  reusableLesson: string | null;
  suggestedImprovement: string | null;
  shouldCreateSkill: boolean;
  shouldAskNextTime: boolean;
  status: string;
  createdAt: string;
}

function Field({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <div className="text-[10px] uppercase tracking-wide text-[--muted-foreground]">{label}</div>
      <p className="text-xs text-[--foreground] leading-relaxed">{value}</p>
    </div>
  );
}

export function ReflectionsView() {
  const [reflections, setReflections] = useState<Reflection[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/learning/reflections")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setError(null);
        setReflections(data);
      })
      .catch(() => setError("Could not load reflections."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(load, [load]);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Brain className="w-4 h-4 text-[--primary]" /> Reflections
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Structured post-task reflection. Currently auto-triggered on chat turns that produce an
        empty response — other triggers (user rejection, tool failure, scheduled replay) call the
        same service once those paths exist.
      </p>

      {error && (
        <p className="mb-3 text-xs text-red-400">
          {error} <button type="button" onClick={load} className="underline hover:no-underline">Retry</button>
        </p>
      )}
      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : reflections.length === 0 && !error ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No reflections recorded yet.
        </div>
      ) : (
        <div className="space-y-3">
          {reflections.map((r) => (
            <div key={r.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3 space-y-2">
              <div className="flex items-center gap-2">
                <span className="text-xs font-medium text-[--foreground]">{r.agentId}</span>
                <span className="text-[10px] text-[--muted-foreground]">{r.reflectionType}</span>
                {r.shouldAskNextTime && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-amber-400">
                    <HelpCircle className="w-3 h-3" /> should ask more next time
                  </span>
                )}
              </div>
              <p className="text-sm text-[--foreground]">{r.summary}</p>
              <div className="grid grid-cols-2 gap-3">
                <Field label="What worked" value={r.whatWorked} />
                <Field label="What failed" value={r.whatFailed} />
                <Field label="Unexpected results" value={r.unexpectedResults} />
                <Field label="Incorrect assumptions" value={r.incorrectAssumptions} />
                <Field label="Missing information" value={r.missingInformation} />
                <Field label="Reusable lesson" value={r.reusableLesson} />
              </div>
              {r.suggestedImprovement && (
                <p className="text-xs text-indigo-400 pt-1 border-t border-[--sidebar-border]">
                  Suggested improvement: {r.suggestedImprovement}
                </p>
              )}
              {r.shouldCreateSkill && (
                <p className="text-xs text-emerald-400 flex items-center gap-1.5">
                  <Lightbulb className="w-3 h-3 shrink-0" /> Flagged as a reusable skill candidate
                </p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
