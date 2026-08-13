"use client";

import { useEffect, useState } from "react";
import { HelpCircle, CheckCircle2, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import type { CuriosityEvent } from "../types";

function ScoreBar({ score }: { score: number }) {
  const color = score >= 0.6 ? "bg-amber-400" : score >= 0.3 ? "bg-indigo-400" : "bg-[--muted-foreground]";
  return (
    <div className="h-1.5 w-20 rounded-full bg-white/5 overflow-hidden">
      <div className={cn("h-full rounded-full", color)} style={{ width: `${Math.round(score * 100)}%` }} />
    </div>
  );
}

export function CuriosityView() {
  const [events, setEvents] = useState<CuriosityEvent[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [showResolved, setShowResolved] = useState(false);
  const [resolvingId, setResolvingId] = useState<string | null>(null);

  useEffect(() => {
    fetch(`/api/learning-core/curiosity${showResolved ? "" : "?unresolved=true"}`)
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }, [showResolved]);

  async function resolve(id: string) {
    const resolution = window.prompt("How was this resolved?");
    if (!resolution) return;
    setResolvingId(id);
    const res = await fetch(`/api/learning-core/curiosity/${id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ resolution }),
    });
    setResolvingId(null);
    if (!res.ok) return;
    const updated = (await res.json()) as CuriosityEvent;
    setEvents((prev) => (showResolved ? prev.map((e) => (e.id === id ? updated : e)) : prev.filter((e) => e.id !== id)));
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-[--foreground] flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-[--primary]" /> Curiosity
        </h1>
        <label className="flex items-center gap-1.5 text-xs text-[--muted-foreground]">
          <input type="checkbox" checked={showResolved} onChange={(e) => setShowResolved(e.target.checked)} />
          Show resolved
        </label>
      </div>
      <p className="text-sm text-[--muted-foreground] mb-6">
        When an agent&apos;s curiosity score crosses {"≥"} 0.6 — low confidence, contradictory memory, missing
        goal, unexpected outcome — it surfaces a question here instead of guessing.
      </p>

      {!loaded ? (
        <div className="flex items-center gap-2 text-xs text-[--muted-foreground]">
          <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading…
        </div>
      ) : events.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No {showResolved ? "" : "unresolved "}curiosity events yet.
        </div>
      ) : (
        <div className="space-y-2">
          {events.map((event) => (
            <div
              key={event.id}
              className="flex items-start justify-between gap-4 rounded-lg border border-[--sidebar-border] bg-[--card] p-3"
            >
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2 mb-1">
                  {event.agent && (
                    <span
                      className="w-5 h-5 rounded-full flex items-center justify-center text-[10px] shrink-0"
                      style={{ backgroundColor: event.agent.color + "22" }}
                    >
                      {event.agent.avatar}
                    </span>
                  )}
                  <span className="text-xs font-medium text-[--foreground] truncate">
                    {event.agent?.name ?? event.agentId}
                  </span>
                  <ScoreBar score={event.score} />
                  <span className="text-[10px] text-[--muted-foreground]">{event.score.toFixed(2)}</span>
                </div>
                {event.question && <p className="text-sm text-[--foreground] mb-1">{event.question}</p>}
                {event.triggerContext && (
                  <p className="text-xs text-[--muted-foreground] truncate">{event.triggerContext}</p>
                )}
                {event.resolved && event.resolution && (
                  <p className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> {event.resolution}
                  </p>
                )}
              </div>
              {!event.resolved && (
                <button
                  onClick={() => resolve(event.id)}
                  disabled={resolvingId === event.id}
                  className="shrink-0 text-xs px-2.5 py-1 rounded-md border border-[--sidebar-border] text-[--muted-foreground] hover:text-[--foreground] hover:border-[--primary]/40 transition-colors"
                >
                  {resolvingId === event.id ? "…" : "Resolve"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
