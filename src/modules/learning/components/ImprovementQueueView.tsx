"use client";

import { useCallback, useEffect, useState } from "react";
import { ListChecks } from "lucide-react";

interface PendingCandidate {
  id: string;
  type: string;
  riskLevel: string;
  problem: string | null;
  approvalRequest: { status: string } | null;
  createdAt: string;
}

interface DraftSkillVersion {
  id: string;
  version: number;
  status: string;
  skill: { name: string; domain: string };
  createdAt: string;
}

export function ImprovementQueueView() {
  const [candidates, setCandidates] = useState<PendingCandidate[]>([]);
  const [skillVersions, setSkillVersions] = useState<DraftSkillVersion[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch("/api/learning/improvement-queue")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setCandidates(data.pendingCandidates ?? []);
        setSkillVersions(data.draftSkillVersions ?? []);
      })
      .catch(() => setError("Could not load the improvement queue."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(load, [load]);

  const totalPending = candidates.length + skillVersions.length;

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <ListChecks className="w-4 h-4 text-[--primary]" /> Improvement Queue
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Everything genuinely waiting on a human decision, across every Learning Core surface — a
        cross-cutting read over existing pending states, not a separate queue.
      </p>

      {error && (
        <p className="mb-3 text-xs text-red-400">
          {error} <button type="button" onClick={load} className="underline hover:no-underline">Retry</button>
        </p>
      )}
      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : totalPending === 0 && !error ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          Nothing pending review right now.
        </div>
      ) : (
        <div className="space-y-4">
          {candidates.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-[--muted-foreground] uppercase tracking-wide mb-2">
                Learning candidates awaiting review ({candidates.length})
              </h2>
              <div className="space-y-1.5">
                {candidates.map((c) => (
                  <div key={c.id} className="flex items-center gap-2 text-xs rounded-lg border border-[--sidebar-border] bg-[--card] p-2">
                    <span className="text-[--foreground]">{c.type}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[--muted-foreground]">{c.riskLevel}</span>
                    {c.approvalRequest && (
                      <span className="text-[10px] text-amber-400">approval: {c.approvalRequest.status}</span>
                    )}
                    {c.problem && <span className="text-[--muted-foreground] truncate">— {c.problem}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
          {skillVersions.length > 0 && (
            <div>
              <h2 className="text-xs font-semibold text-[--muted-foreground] uppercase tracking-wide mb-2">
                Skill versions awaiting activation ({skillVersions.length})
              </h2>
              <div className="space-y-1.5">
                {skillVersions.map((v) => (
                  <div key={v.id} className="flex items-center gap-2 text-xs rounded-lg border border-[--sidebar-border] bg-[--card] p-2">
                    <span className="text-[--foreground]">{v.skill.name}</span>
                    <span className="text-[10px] text-[--muted-foreground]">v{v.version}</span>
                    <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[--muted-foreground]">{v.skill.domain}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
