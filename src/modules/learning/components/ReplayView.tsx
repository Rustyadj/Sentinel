"use client";

import { useCallback, useEffect, useState } from "react";
import { History, Play } from "lucide-react";

const CATEGORIES = [
  "failure",
  "partial_outcome",
  "high_cost",
  "strongest_success",
  "rejected_answer",
  "rolled_back",
] as const;

const UNIMPLEMENTED_CATEGORIES = ["tool_failure", "workflow_failure", "retrieval_failure", "user_correction", "memory_conflict"];

interface ReplayRun {
  id: string;
  category: string;
  summary: string;
  lessons: string[];
  improvementOpportunities: string[];
  runDate: string;
}

export function ReplayView() {
  const [runs, setRuns] = useState<ReplayRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState<string | null>(null);

  const load = useCallback(() => {
    fetch("/api/learning/replay")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setError(null);
        setRuns(data);
      })
      .catch(() => setError("Could not load replay runs."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function runReplay(category: string) {
    setRunning(category);
    try {
      const response = await fetch("/api/learning/replay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ category }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => ({}));
        throw new Error(body.error ?? `Replay run failed (${response.status})`);
      }
      load();
    } catch (runError) {
      setError(runError instanceof Error ? runError.message : "Replay run failed.");
    } finally {
      setRunning(null);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <History className="w-4 h-4 text-[--primary]" /> Experience Replay
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-4">
        Replays batches of already-completed Experiences — sanitized, no side effects, no live
        model calls — into Reflections and shadow-pipeline benchmark data. Categories requiring
        structured tool/workflow/retrieval provenance Experience doesn&apos;t record yet
        ({UNIMPLEMENTED_CATEGORIES.join(", ")}) aren&apos;t implemented — shown here honestly, not
        silently skipped.
      </p>

      <div className="flex flex-wrap gap-2 mb-6">
        {CATEGORIES.map((category) => (
          <button
            key={category}
            onClick={() => runReplay(category)}
            disabled={running === category}
            className="text-xs px-2.5 py-1.5 rounded-md border border-[--sidebar-border] text-[--muted-foreground] hover:text-[--foreground] hover:border-[--primary]/40 transition-colors disabled:opacity-50 flex items-center gap-1.5"
          >
            <Play className="w-3 h-3" /> {running === category ? "Running…" : category.replaceAll("_", " ")}
          </button>
        ))}
      </div>

      {error && (
        <p className="mb-3 text-xs text-red-400">
          {error} <button type="button" onClick={load} className="underline hover:no-underline">Retry</button>
        </p>
      )}
      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : runs.length === 0 && !error ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No replay runs yet — pick a category above.
        </div>
      ) : (
        <div className="space-y-2">
          {runs.map((run) => (
            <div key={run.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
              <div className="flex items-center gap-2 mb-1">
                <span className="text-xs px-1.5 py-0.5 rounded-full bg-white/5 text-[--muted-foreground] uppercase tracking-wide">
                  {run.category.replaceAll("_", " ")}
                </span>
                <span className="text-[10px] text-[--muted-foreground] ml-auto">{new Date(run.runDate).toLocaleString()}</span>
              </div>
              <p className="text-xs text-[--foreground]">{run.summary}</p>
              {run.lessons.length > 0 && (
                <p className="text-xs text-emerald-400 mt-1">Lessons: {run.lessons.join("; ")}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
