"use client";

import { useCallback, useEffect, useState } from "react";
import { Layers, Play } from "lucide-react";

interface LearningCandidate {
  id: string;
  type: string;
  status: string;
  problem: string | null;
}

interface ShadowRun {
  id: string;
  passed: boolean | null;
  createdAt: string;
  outputSnapshot: { unsupported?: boolean; executorName?: string | null; reasons?: string[] };
}

interface PromotionEvaluation {
  passed: boolean;
  reasons: string[];
  sampleSize: number;
  passRate: number | null;
  confidenceLowerBound: number | null;
}

export function ShadowRunsView() {
  const [candidates, setCandidates] = useState<LearningCandidate[]>([]);
  const [selectedCandidate, setSelectedCandidate] = useState<string>("");
  const [sourceExperienceId, setSourceExperienceId] = useState("");
  const [runs, setRuns] = useState<ShadowRun[]>([]);
  const [promotion, setPromotion] = useState<PromotionEvaluation | null>(null);
  const [running, setRunning] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/learning/candidates?status=proposed&limit=50")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(setCandidates)
      .catch(() => setError("Could not load candidates."));
  }, []);

  const loadShadowState = useCallback((candidateId: string) => {
    if (!candidateId) return;
    fetch(`/api/learning/candidates/${candidateId}/shadow`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setRuns(data.runs ?? []);
        setPromotion(data.promotion ?? null);
      })
      .catch(() => setError("Could not load shadow runs for this candidate."));
  }, []);

  useEffect(() => {
    loadShadowState(selectedCandidate);
  }, [selectedCandidate, loadShadowState]);

  async function runSample() {
    if (!selectedCandidate || !sourceExperienceId) return;
    setRunning(true);
    setError(null);
    try {
      const res = await fetch(`/api/learning/candidates/${selectedCandidate}/shadow`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ sourceExperienceId }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? String(res.status));
      }
      loadShadowState(selectedCandidate);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to run shadow sample");
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Layers className="w-4 h-4 text-[--primary]" /> Shadow Runs
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Candidate behavior replayed against recorded Experience fixtures — never live re-inference,
        never a user-visible side effect. Promotion requires a minimum sample size and a Wilson
        confidence lower bound above threshold, not one good run.
      </p>

      <div className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3 mb-4 space-y-2">
        <div className="flex gap-2">
          <select
            value={selectedCandidate}
            onChange={(e) => setSelectedCandidate(e.target.value)}
            className="flex-1 text-xs bg-transparent border border-[--sidebar-border] rounded-md px-2 py-1.5 text-[--foreground]"
          >
            <option value="">Select a candidate…</option>
            {candidates.map((c) => (
              <option key={c.id} value={c.id}>
                {c.type} — {c.problem?.slice(0, 60) ?? c.id}
              </option>
            ))}
          </select>
        </div>
        <div className="flex gap-2">
          <input
            value={sourceExperienceId}
            onChange={(e) => setSourceExperienceId(e.target.value)}
            placeholder="Source Experience id (fixture)"
            className="flex-1 text-xs bg-transparent border border-[--sidebar-border] rounded-md px-2 py-1.5 text-[--foreground] placeholder:text-[--muted-foreground]"
          />
          <button
            onClick={runSample}
            disabled={running || !selectedCandidate || !sourceExperienceId}
            className="flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-md border border-[--sidebar-border] text-[--muted-foreground] hover:text-[--foreground] hover:border-[--primary]/40 transition-colors disabled:opacity-50"
          >
            <Play className="w-3.5 h-3.5" /> {running ? "Running…" : "Run sample"}
          </button>
        </div>
        {error && <p className="text-xs text-red-400">{error}</p>}
      </div>

      {selectedCandidate && promotion && (
        <div className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3 mb-4">
          <div className="flex items-center gap-2 mb-2">
            <span className={`text-xs font-medium ${promotion.passed ? "text-emerald-400" : "text-amber-400"}`}>
              {promotion.passed ? "Promotion gate: passed" : "Promotion gate: not yet"}
            </span>
            <span className="text-[10px] text-[--muted-foreground]">
              sample {promotion.sampleSize}, pass rate {promotion.passRate?.toFixed(2) ?? "—"}, confidence
              lower bound {promotion.confidenceLowerBound?.toFixed(2) ?? "—"}
            </span>
          </div>
          {promotion.reasons.map((reason, i) => (
            <p key={i} className="text-xs text-[--muted-foreground]">
              — {reason}
            </p>
          ))}
        </div>
      )}

      {selectedCandidate && (
        <div className="space-y-1.5">
          {runs.length === 0 ? (
            <p className="text-xs text-[--muted-foreground]">No shadow runs recorded for this candidate yet.</p>
          ) : (
            runs.map((run) => {
              const unsupported = run.outputSnapshot?.unsupported;
              return (
                <div key={run.id} className="flex items-center gap-2 text-xs rounded-lg border border-[--sidebar-border] bg-[--card] p-2">
                  <span className={unsupported ? "text-[--muted-foreground]" : run.passed ? "text-emerald-400" : "text-red-400"}>
                    {unsupported ? "unsupported" : run.passed ? "passed" : "failed"}
                  </span>
                  {run.outputSnapshot?.executorName && (
                    <span className="text-[--muted-foreground]">via {run.outputSnapshot.executorName}</span>
                  )}
                  {run.outputSnapshot?.reasons && run.outputSnapshot.reasons.length > 0 && (
                    <span className="text-amber-400 truncate">{run.outputSnapshot.reasons.join("; ")}</span>
                  )}
                  <span className="ml-auto text-[10px] text-[--muted-foreground]">{new Date(run.createdAt).toLocaleString()}</span>
                </div>
              );
            })
          )}
        </div>
      )}
    </div>
  );
}
