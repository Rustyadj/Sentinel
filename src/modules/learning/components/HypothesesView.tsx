"use client";

import { useCallback, useEffect, useState } from "react";
import { Target, RefreshCw, ChevronDown, ChevronRight } from "lucide-react";

interface LearningGoal {
  id: string;
  title: string;
  objective: string;
  priority: string;
  status: string;
  approved: boolean;
  knowledgeGapId: string | null;
  createdAt: string;
}

interface LearningCandidate {
  id: string;
  type: string;
  riskLevel: string;
  status: string;
  problem: string | null;
  createdAt: string;
}

const PRIORITY_STYLES: Record<string, string> = {
  high: "bg-red-500/15 text-red-400",
  medium: "bg-amber-500/15 text-amber-400",
  low: "bg-[--muted-foreground]/10 text-[--muted-foreground]",
};

function CandidateList({ goalId }: { goalId: string }) {
  const [candidates, setCandidates] = useState<LearningCandidate[] | null>(null);

  useEffect(() => {
    fetch(`/api/learning/goals/${goalId}`)
      .then((r) => r.json())
      .then((data) => setCandidates(data.candidates ?? []))
      .catch(() => setCandidates([]));
  }, [goalId]);

  if (candidates === null) return <p className="text-xs text-[--muted-foreground] pl-6">Loading candidates…</p>;
  if (candidates.length === 0) {
    return <p className="text-xs text-[--muted-foreground] pl-6">No candidates proposed yet for this goal.</p>;
  }
  return (
    <div className="pl-6 space-y-1.5">
      {candidates.map((c) => (
        <div key={c.id} className="flex items-center gap-2 text-xs">
          <span className="text-[--foreground]">{c.type}</span>
          <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[--muted-foreground]">{c.riskLevel}</span>
          <span className="text-[10px] text-[--muted-foreground]">{c.status}</span>
          {c.problem && <span className="text-[--muted-foreground] truncate">— {c.problem}</span>}
        </div>
      ))}
    </div>
  );
}

export function HypothesesView() {
  const [goals, setGoals] = useState<LearningGoal[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [error, setError] = useState(false);

  const load = useCallback(() => {
    fetch("/api/learning/goals")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(setGoals)
      .catch(() => setError(true))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function generateFromGaps() {
    setGenerating(true);
    setError(false);
    try {
      const res = await fetch("/api/learning/goals", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      if (!res.ok) throw new Error(String(res.status));
      load();
    } catch {
      setError(true);
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-[--foreground] flex items-center gap-2">
          <Target className="w-4 h-4 text-[--primary]" /> Hypotheses
        </h1>
        <button
          onClick={generateFromGaps}
          disabled={generating}
          className="flex items-center gap-1.5 text-xs px-2.5 py-1.5 rounded-md border border-[--sidebar-border] text-[--muted-foreground] hover:text-[--foreground] hover:border-[--primary]/40 transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${generating ? "animate-spin" : ""}`} />
          {generating ? "Generating…" : "Generate from gaps"}
        </button>
      </div>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Learning Goals generated from material knowledge gaps (priority ≥ 0.5), each tracked
        through to the LearningCandidate(s) proposed to close it — reusing the existing Neural
        Engine candidate pipeline, not a separate hypothesis model.
      </p>

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          Couldn&apos;t load goals.
        </div>
      ) : goals.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No learning goals yet — click &quot;Generate from gaps&quot; once a Knowledge Gap
          crosses the material threshold.
        </div>
      ) : (
        <div className="space-y-2">
          {goals.map((goal) => {
            const isOpen = expanded === goal.id;
            return (
              <div key={goal.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
                <button
                  className="flex items-center gap-2 w-full text-left"
                  onClick={() => setExpanded(isOpen ? null : goal.id)}
                >
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5 text-[--muted-foreground]" /> : <ChevronRight className="w-3.5 h-3.5 text-[--muted-foreground]" />}
                  <span className="text-sm text-[--foreground] flex-1 truncate">{goal.title}</span>
                  <span className={`text-[10px] px-1.5 py-0.5 rounded-full uppercase tracking-wide ${PRIORITY_STYLES[goal.priority] ?? PRIORITY_STYLES.low}`}>
                    {goal.priority}
                  </span>
                  <span className="text-[10px] text-[--muted-foreground]">{goal.status}</span>
                </button>
                {isOpen && (
                  <div className="mt-2 space-y-2">
                    <p className="text-xs text-[--muted-foreground] pl-6">{goal.objective}</p>
                    <CandidateList goalId={goal.id} />
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
