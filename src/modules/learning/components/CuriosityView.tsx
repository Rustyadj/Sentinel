"use client";

import { useEffect, useState } from "react";
import { HelpCircle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface CuriosityEvent {
  id: string;
  agentId: string;
  triggerType: string;
  question: string | null;
  reason: string | null;
  curiosityScore: number;
  asked: boolean;
  answered: boolean;
  answerSummary: string | null;
  createdAt: string;
}

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
  const [unansweredOnly, setUnansweredOnly] = useState(true);
  const [answeringId, setAnsweringId] = useState<string | null>(null);

  function load() {
    fetch(`/api/learning/curiosity${unansweredOnly ? "?unanswered=true" : ""}`)
      .then((r) => r.json())
      .then(setEvents)
      .catch(() => {})
      .finally(() => setLoaded(true));
  }

  useEffect(load, [unansweredOnly]);

  async function answer(id: string) {
    const answerSummary = window.prompt("What was the answer / resolution?");
    if (!answerSummary) return;
    setAnsweringId(id);
    await fetch(`/api/learning/curiosity/${id}/answer`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ answerSummary }),
    }).catch(() => {});
    setAnsweringId(null);
    load();
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-[--foreground] flex items-center gap-2">
          <HelpCircle className="w-4 h-4 text-[--primary]" /> Curiosity
        </h1>
        <label className="flex items-center gap-1.5 text-xs text-[--muted-foreground]">
          <input type="checkbox" checked={unansweredOnly} onChange={(e) => setUnansweredOnly(e.target.checked)} />
          Unanswered only
        </label>
      </div>
      <p className="text-sm text-[--muted-foreground] mb-6">
        When an agent&apos;s curiosity score crosses 0.6 — low confidence, ambiguity, conflicting
        context, high business impact, urgency — it asks instead of guessing. Every decision is
        recorded here, including the ones below threshold that didn&apos;t trigger a question.
      </p>

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : events.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No {unansweredOnly ? "unanswered " : ""}curiosity events yet.
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
                  <span className="text-xs font-medium text-[--foreground] truncate">{event.agentId}</span>
                  <span className="text-[10px] text-[--muted-foreground]">{event.triggerType.replaceAll("_", " ")}</span>
                  <ScoreBar score={event.curiosityScore} />
                  <span className="text-[10px] text-[--muted-foreground]">{event.curiosityScore.toFixed(2)}</span>
                </div>
                {event.question ? (
                  <p className="text-sm text-[--foreground] mb-1">{event.question}</p>
                ) : (
                  <p className="text-xs text-[--muted-foreground] italic mb-1">Below threshold — no question asked</p>
                )}
                {event.reason && <p className="text-xs text-[--muted-foreground] truncate">{event.reason}</p>}
                {event.answered && event.answerSummary && (
                  <p className="mt-1.5 text-xs text-emerald-400 flex items-center gap-1">
                    <CheckCircle2 className="w-3 h-3" /> {event.answerSummary}
                  </p>
                )}
              </div>
              {event.asked && !event.answered && (
                <button
                  onClick={() => answer(event.id)}
                  disabled={answeringId === event.id}
                  className="shrink-0 text-xs px-2.5 py-1 rounded-md border border-[--sidebar-border] text-[--muted-foreground] hover:text-[--foreground] hover:border-[--primary]/40 transition-colors"
                >
                  {answeringId === event.id ? "…" : "Answer"}
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
