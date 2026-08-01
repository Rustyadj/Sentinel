"use client";

import { useEffect, useState } from "react";
import { History, Loader2, PlayCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import type { ReplayEntry } from "../types";

const CATEGORY_STYLES: Record<string, string> = {
  failure: "bg-red-500/15 text-red-400",
  unresolved_curiosity: "bg-amber-500/15 text-amber-400",
  expensive: "bg-orange-500/15 text-orange-400",
  hallucination: "bg-purple-500/15 text-purple-400",
};

export function ReplayView() {
  const [entries, setEntries] = useState<ReplayEntry[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [running, setRunning] = useState(false);

  function load() {
    fetch("/api/learning-core/replay")
      .then((r) => r.json())
      .then(setEntries)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }

  useEffect(load, []);

  async function runNow() {
    setRunning(true);
    await fetch("/api/learning-core/replay/run", { method: "POST" }).catch(() => {});
    setRunning(false);
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-[--foreground] flex items-center gap-2">
          <History className="w-4 h-4 text-[--primary]" /> Experience Replay
        </h1>
        <button
          onClick={runNow}
          disabled={running}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[--sidebar-border] text-[--muted-foreground] hover:text-[--foreground] hover:border-[--primary]/40 transition-colors"
        >
          <PlayCircle className="w-3.5 h-3.5" /> {running ? "Running…" : "Run now"}
        </button>
      </div>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Aggregates failures, unresolved questions, and severe trust events from the last 24h into
        lessons and improvement opportunities. No scheduler is wired up yet — run manually until one is.
      </p>

      {!loaded ? (
        <div className="flex items-center gap-2 text-xs text-[--muted-foreground]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : entries.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No replay entries yet — click &quot;Run now&quot;.
        </div>
      ) : (
        <div className="space-y-2">
          {entries.map((entry) => (
            <div key={entry.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3 space-y-1.5">
              <div className="flex items-center gap-2">
                <span className={cn("text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide", CATEGORY_STYLES[entry.category] ?? "bg-[--muted-foreground]/10 text-[--muted-foreground]")}>
                  {entry.category.replaceAll("_", " ")}
                </span>
                <span className="text-[10px] text-[--muted-foreground]">
                  {new Date(entry.runDate).toLocaleString()}
                </span>
              </div>
              <p className="text-sm text-[--foreground]">{entry.summary}</p>
              {entry.lessons.length > 0 && (
                <p className="text-xs text-emerald-400">Lesson: {entry.lessons.join("; ")}</p>
              )}
              {entry.improvementOpportunities.length > 0 && (
                <p className="text-xs text-indigo-400">Opportunity: {entry.improvementOpportunities.join("; ")}</p>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
