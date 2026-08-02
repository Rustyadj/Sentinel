"use client";

import { useEffect, useState } from "react";
import { Sparkles, Activity } from "lucide-react";

interface OverviewData {
  experiences: { total: number; byStatus: Record<string, number> };
  learningCandidates: {
    total: number;
    byStatus: Record<string, number>;
    byRiskLevel: Record<string, number>;
  };
  agentCompetency: { avgScore: number | null; domainsTracked: number };
  learningEvents: {
    total: number;
    recent: Array<{ id: string; eventType: string; agentId: string | null; severity: string; createdAt: string }>;
  };
}

function StatCard({ label, value, breakdown }: { label: string; value: string | number; breakdown?: Record<string, number> }) {
  return (
    <div className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
      <div className="text-2xl font-semibold text-[--foreground]">{value}</div>
      <div className="text-xs text-[--muted-foreground] mt-1">{label}</div>
      {breakdown && Object.keys(breakdown).length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {Object.entries(breakdown).map(([key, count]) => (
            <span key={key} className="text-[10px] px-1.5 py-0.5 rounded-full bg-white/5 text-[--muted-foreground]">
              {key.replaceAll("_", " ")}: {count}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export function OverviewView() {
  const [data, setData] = useState<OverviewData | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [error, setError] = useState(false);

  useEffect(() => {
    fetch("/api/learning/overview")
      .then((r) => {
        if (!r.ok) throw new Error(String(r.status));
        return r.json();
      })
      .then(setData)
      .catch(() => setError(true))
      .finally(() => setLoaded(true));
  }, []);

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-lg font-semibold text-[--foreground] mb-1 flex items-center gap-2">
        <Sparkles className="w-4 h-4 text-[--primary]" /> Learning Core
      </h1>
      <p className="text-sm text-[--muted-foreground] mb-6">
        Observation, evaluation, experimentation, and governance over the Neural Engine — see{" "}
        <code className="text-[--foreground]">docs/LEARNING_CORE_ON_NEURAL_ENGINE.md</code> for what&apos;s
        live vs. planned.
      </p>

      {!loaded ? (
        <div className="text-xs text-[--muted-foreground]">Loading…</div>
      ) : error || !data ? (
        <div className="text-xs text-[--muted-foreground] border border-dashed border-[--sidebar-border] rounded-lg p-6 text-center">
          Couldn&apos;t load overview data.
        </div>
      ) : (
        <div className="space-y-6">
          <div className="grid grid-cols-3 gap-3">
            <StatCard label="Experiences" value={data.experiences.total} breakdown={data.experiences.byStatus} />
            <StatCard
              label="Learning candidates"
              value={data.learningCandidates.total}
              breakdown={data.learningCandidates.byStatus}
            />
            <StatCard
              label="Avg. agent competency"
              value={data.agentCompetency.avgScore !== null ? data.agentCompetency.avgScore.toFixed(2) : "—"}
            />
            <StatCard
              label="By risk level"
              value={data.learningCandidates.total}
              breakdown={data.learningCandidates.byRiskLevel}
            />
            <StatCard label="Competency domains tracked" value={data.agentCompetency.domainsTracked} />
            <StatCard label="Learning events" value={data.learningEvents.total} />
          </div>

          <div className="rounded-lg border border-[--sidebar-border] bg-[--card] p-4">
            <h2 className="text-xs font-semibold text-[--foreground] mb-3 flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-[--primary]" /> Recent learning events
            </h2>
            {data.learningEvents.recent.length === 0 ? (
              <p className="text-xs text-[--muted-foreground]">
                None yet — events emit as agents complete chat turns.
              </p>
            ) : (
              <div className="space-y-1.5">
                {data.learningEvents.recent.map((event) => (
                  <div key={event.id} className="flex items-center gap-2 text-xs">
                    <span
                      className={
                        event.severity === "error" || event.severity === "critical"
                          ? "text-red-400"
                          : event.severity === "warning"
                            ? "text-amber-400"
                            : "text-[--muted-foreground]"
                      }
                    >
                      {event.eventType}
                    </span>
                    {event.agentId && <span className="text-[--muted-foreground]">· {event.agentId}</span>}
                    <span className="ml-auto text-[10px] text-[--muted-foreground]">
                      {new Date(event.createdAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
