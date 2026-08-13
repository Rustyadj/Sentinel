"use client";

import { useCallback, useEffect, useState } from "react";
import { ShieldCheck } from "lucide-react";

interface GuardianDecision {
  id: string;
  action: string;
  actor: string;
  tier: number;
  mode: string;
  risk: string;
  guardianDecision: string;
  reasonCodes: string[];
  blocked: boolean;
  createdAt: string;
}

const MODE_COLOR: Record<string, string> = {
  observe: "bg-sky-500/15 text-sky-400",
  review: "bg-amber-500/15 text-amber-400",
  block: "bg-red-500/15 text-red-400",
};

const DECISION_COLOR: Record<string, string> = {
  allow: "bg-emerald-500/15 text-emerald-400",
  hold: "bg-amber-500/15 text-amber-400",
  block: "bg-red-500/15 text-red-400",
};

export function GuardianView() {
  const [decisions, setDecisions] = useState<GuardianDecision[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [blockedOnly, setBlockedOnly] = useState(false);

  const load = useCallback((onlyBlocked: boolean) => {
    fetch(`/api/learning/guardian${onlyBlocked ? "?blockedOnly=true" : ""}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setError(null);
        setDecisions(data);
      })
      .catch(() => setError("Could not load Guardian decisions."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load(blockedOnly);
  }, [load, blockedOnly]);

  return (
    <div className="p-6 max-w-4xl">
      <div className="flex items-center justify-between mb-1">
        <h1 className="text-lg font-semibold text-[--foreground] flex items-center gap-2">
          <ShieldCheck className="w-4 h-4 text-[--primary]" /> Guardian
        </h1>
        <label className="flex items-center gap-1.5 text-[10px] text-[--muted-foreground]">
          <input type="checkbox" checked={blockedOnly} onChange={(e) => setBlockedOnly(e.target.checked)} />
          blocked only
        </label>
      </div>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Independent monitoring role — Tier 1 observes asynchronously, Tier 2 holds for review, Tier 3
        always requires human approval and can never be bypassed by trust or Guardian confidence.
        Guardian can never approve its own privilege elevation.
      </p>

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-400 border border-red-500/20 rounded-lg p-6 text-center">{error}</div>
      ) : decisions.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No Guardian decisions recorded yet.
        </div>
      ) : (
        <div className="space-y-1.5">
          {decisions.map((d) => (
            <div key={d.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
              <div className="flex items-center gap-2 flex-wrap">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${MODE_COLOR[d.mode] ?? MODE_COLOR.observe}`}>
                  Tier {d.tier} · {d.mode}
                </span>
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${DECISION_COLOR[d.guardianDecision] ?? DECISION_COLOR.hold}`}>
                  {d.guardianDecision}
                </span>
                <span className="text-[10px] text-[--muted-foreground]">by {d.actor}</span>
              </div>
              <p className="text-xs text-[--foreground] mt-1.5">{d.action}</p>
              {d.reasonCodes.length > 0 && (
                <div className="flex flex-wrap gap-1 mt-1.5">
                  {d.reasonCodes.map((code) => (
                    <span key={code} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[--muted-foreground]">
                      {code}
                    </span>
                  ))}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
