"use client";

import { useCallback, useEffect, useState } from "react";
import { HeartPulse } from "lucide-react";

interface MemoryRow {
  id: string;
  content: string;
  state: string;
  valueScore: number | null;
  poisonRisk: number | null;
  contradictionCount: number;
  confirmationCount: number;
  updatedAt: string;
}

const STATE_COLOR: Record<string, string> = {
  active: "bg-emerald-500/15 text-emerald-400",
  stable: "bg-sky-500/15 text-sky-400",
  candidate: "bg-white/5 text-[--muted-foreground]",
  stale: "bg-amber-500/15 text-amber-400",
  disputed: "bg-orange-500/15 text-orange-400",
  quarantined: "bg-red-500/15 text-red-400",
  archived: "bg-white/5 text-[--muted-foreground]/70",
  forgotten: "bg-white/5 text-[--muted-foreground]/50",
};

export function MemoryHealthView() {
  const [memories, setMemories] = useState<MemoryRow[]>([]);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState<string | null>(null);

  const load = useCallback((state?: string | null) => {
    const qs = state ? `?state=${state}` : "";
    fetch(`/api/learning/memory-health${qs}`)
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then((data) => {
        setError(null);
        setMemories(data.memories);
        setCounts(data.stateCounts);
      })
      .catch(() => setError("Could not load memory health."))
      .finally(() => setLoaded(true));
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const act = async (id: string, action: "quarantine" | "validate" | "forget") => {
    await fetch(`/api/learning/memory-health/${id}/${action}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
    load(filter);
  };

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <HeartPulse className="w-4 h-4 text-[--primary]" /> Memory Health
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Sentinel does not remember everything forever. Net memory value weighs usefulness, confidence,
        transferability, and confirmation against harm, staleness, retrieval cost, poison risk, and
        unresolved contradiction. Quarantined memory never enters normal retrieval until validated.
      </p>

      {loaded && Object.keys(counts).length > 0 && (
        <div className="flex flex-wrap gap-1.5 mb-4">
          {Object.entries(counts).map(([state, count]) => (
            <button
              key={state}
              type="button"
              onClick={() => {
                const next = filter === state ? null : state;
                setFilter(next);
                load(next);
              }}
              className={`text-[10px] px-2 py-1 rounded-full ${filter === state ? "ring-1 ring-violet-400" : ""} ${STATE_COLOR[state] ?? STATE_COLOR.candidate}`}
            >
              {state}: {count}
            </button>
          ))}
        </div>
      )}

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : error ? (
        <div className="text-xs text-red-400 border border-red-500/20 rounded-lg p-6 text-center">{error}</div>
      ) : memories.length === 0 ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          No memories to show.
        </div>
      ) : (
        <div className="space-y-1.5">
          {memories.map((m) => (
            <div key={m.id} className="rounded-lg border border-[--sidebar-border] bg-[--card] p-3">
              <div className="flex items-center gap-2">
                <span className={`text-[10px] px-1.5 py-0.5 rounded-full ${STATE_COLOR[m.state] ?? STATE_COLOR.candidate}`}>
                  {m.state}
                </span>
                <span className="text-[10px] text-[--muted-foreground]">
                  value {m.valueScore?.toFixed(2) ?? "—"} · poison {m.poisonRisk?.toFixed(2) ?? "—"} · contradictions {m.contradictionCount}
                </span>
              </div>
              <p className="text-xs text-[--foreground] mt-1.5 line-clamp-2">{m.content}</p>
              <div className="flex gap-2 mt-2">
                {m.state === "quarantined" ? (
                  <button type="button" onClick={() => act(m.id, "validate")} className="text-[10px] px-2 py-1 rounded-md bg-emerald-500/15 text-emerald-400 hover:bg-emerald-500/25">
                    Validate
                  </button>
                ) : (
                  <button type="button" onClick={() => act(m.id, "quarantine")} className="text-[10px] px-2 py-1 rounded-md bg-amber-500/15 text-amber-400 hover:bg-amber-500/25">
                    Quarantine
                  </button>
                )}
                {m.state !== "forgotten" && (
                  <button type="button" onClick={() => act(m.id, "forget")} className="text-[10px] px-2 py-1 rounded-md bg-white/5 text-[--muted-foreground] hover:bg-white/10">
                    Forget
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
