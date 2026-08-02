"use client";

import { useEffect, useState } from "react";
import { GitCommitVertical } from "lucide-react";

interface LearningEventRow {
  id: string;
  eventType: string;
  sourceType: string | null;
  agentId: string | null;
  severity: string;
  createdAt: string;
}

const SEVERITY_COLOR: Record<string, string> = {
  critical: "text-red-400",
  error: "text-red-400",
  warning: "text-amber-400",
  info: "text-[--muted-foreground]",
  debug: "text-[--muted-foreground]/70",
};

export function EvolutionView() {
  const [events, setEvents] = useState<LearningEventRow[]>([]);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    fetch("/api/learning/timeline?limit=150")
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <GitCommitVertical className="w-4 h-4 text-[--primary]" /> Evolution Timeline
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Every phase&apos;s real activity — curiosity, reflection, candidate proposal/review/apply/
        rollback, benchmarks, feature-flag changes — already emits a LearningEvent. This is a
        direct read over that stream, not a second event log.
      </p>

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No events recorded yet.
        </div>
      ) : (
        <div className="space-y-1">
          {events.map((event) => (
            <div key={event.id} className="flex items-center gap-2 text-xs border-l-2 border-[--sidebar-border] pl-3 py-1">
              <span className={SEVERITY_COLOR[event.severity] ?? "text-[--muted-foreground]"}>{event.eventType}</span>
              {event.sourceType && <span className="text-[10px] text-[--muted-foreground]">{event.sourceType}</span>}
              {event.agentId && <span className="text-[10px] text-[--muted-foreground]">· {event.agentId}</span>}
              <span className="ml-auto text-[10px] text-[--muted-foreground]">{new Date(event.createdAt).toLocaleString()}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
