"use client";

import { useCallback, useEffect, useState } from "react";
import { Swords } from "lucide-react";

interface AdversarialRun {
  id: string;
  attackType: string;
  targetSurface: string;
  outcome: string;
  severity: string;
  judgeNotes: string | null;
  candidateId: string | null;
  evalCaseId: string | null;
  createdAt: string;
}

const OUTCOME_COLOR: Record<string, string> = {
  blocked: "bg-emerald-500/15 text-emerald-400",
  breached: "bg-red-500/15 text-red-400",
  inconclusive: "bg-amber-500/15 text-amber-400",
  pending: "bg-white/5 text-[--muted-foreground]",
};

export function AdversarialView() {
  const [runs, setRuns] = useState<AdversarialRun[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(() => {
    fetch("/api/learning/adversarial")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setError(null);
        setRuns(data);
      })
      .catch(() => setError("Could not load adversarial runs."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const runBattery = async () => {
    setRunning(true);
    try {
      await fetch("/api/learning/adversarial/run", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      load();
    } finally {
      setRunning(false);
    }
  };

  const blockedCount = runs.filter((r) => r.outcome === "blocked").length;
  const breachedCount = runs.filter((r) => r.outcome === "breached").length;

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-[--foreground] flex items-center gap-2">
          <Swords className="w-4 h-4 text-[--primary]" /> Adversarial Self-Play
        </h1>
        <button
          type="button"
          onClick={runBattery}
          disabled={running}
          className="text-xs px-3 py-1.5 rounded-md bg-violet-500/15 text-violet-300 hover:bg-violet-500/25 disabled:opacity-50"
        >
          {running ? "Running…" : "Run battery"}
        </button>
      </div>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Sandboxed Attacker / Defender / Judge / Guardian roles against the champion (or a given
        challenger). A successful attack becomes a permanent EvalCase — Sentinel gets meaningfully
        less likely to repeat the same breach.
      </p>

      {loaded && runs.length > 0 && (
        <div className="flex gap-3 mb-4 text-xs">
          <span className="text-emerald-400">{blockedCount} blocked</span>
          <span className="text-red-400">{breachedCount} breached</span>
          <span className="text-[--muted-foreground]">{runs.length} total</span>
        </div>
      )}

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-400 border border-red-500/20 rounded-lg p-6 text-center">{error}</div>
      ) : runs.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No adversarial runs yet — run the battery to exercise the current defenses.
        </div>
      ) : (
        <div className="space-y-1.5">
          {runs.map((r) => (
            <div key={r.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${OUTCOME_COLOR[r.outcome] ?? OUTCOME_COLOR.pending}`}>
                  {r.outcome}
                </span>
                <span className="text-xs text-[--foreground]">{r.attackType}</span>
                <span className="text-[10px] text-[--muted-foreground]">→ {r.targetSurface}</span>
                {r.evalCaseId && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-violet-500/15 text-violet-300">
                    regression case created
                  </span>
                )}
              </div>
              {r.judgeNotes && <p className="text-[11px] text-[--muted-foreground] mt-1.5">{r.judgeNotes}</p>}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
