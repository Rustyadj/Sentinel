"use client";

// Shared Graph-First Lens Overview — the first tab of every major Sentinel
// workspace. Mounts the SAME canonical NeuralLens graph every lens uses,
// centers + illuminates the lens's cluster, and surrounds it with the four
// real, database-backed supporting panels every lens needs (Lens Status /
// Active Runs / Alerts / Recent Changes). There is exactly one of these
// components — per-lens differences come entirely from LENS_CONFIG + the
// stats a lens's page fetches, never from a forked copy of this file.

import { useEffect, useRef, type ElementType } from "react";
import { AlertTriangle, Activity, Gauge, History } from "lucide-react";
import { useGraphStore } from "@/store/useGraphStore";
import { NeuralLens } from "./NeuralLens";
import type { GlobeGraphApi } from "./NeuralLensGraph";
import { LENS_CONFIG, type LensId } from "@/lib/lensRegistry";
import type { LensOverviewStats } from "@/lib/workspaces/lensStats";
import { useNeuralStream } from "./useNeuralStream";
import { TraceReplayPanel } from "./TraceReplayPanel";
import { cn } from "@/lib/utils";

const FOCUS_RETRY_MS = 150;
const FOCUS_MAX_ATTEMPTS = 24; // ~3.6s — covers WebGL init + first graph load

export function relativeTime(at: Date): string {
  const diffMs = Date.now() - at.getTime();
  const minutes = Math.round(diffMs / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.round(hours / 24)}d ago`;
}

function Panel({ title, icon: Icon, children }: { title: string; icon: ElementType; children: React.ReactNode }) {
  return (
    <div className="rounded-lg border border-[--canvas-card-border] bg-[--canvas-card] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[--muted-foreground]">
        <Icon className="h-3.5 w-3.5" />
        {title}
      </div>
      {children}
    </div>
  );
}

function Empty({ children }: { children: React.ReactNode }) {
  return <p className="py-2 text-xs text-[--muted-foreground]">{children}</p>;
}

/**
 * Reuses the canonical NeuralLens canvas as the first tab of a workspace.
 * On mount, it targets the lens's cluster in the shared graph store — which
 * NeuralLensGraph already dims/illuminates around (lensClusterId) — and, only
 * when arriving from a *different* lens, animates the camera to frame it.
 * Returning to Overview from another tab of the same lens leaves the
 * operator's camera exactly where they left it.
 */
export function LensOverview({ lens, stats }: { lens: LensId; stats: LensOverviewStats | null }) {
  const config = LENS_CONFIG[lens];
  const apiRef = useRef<GlobeGraphApi | null>(null);
  const setLensCluster = useGraphStore((state) => state.setLensCluster);
  const { connected } = useNeuralStream({ enabled: true });

  useEffect(() => {
    const previousCluster = useGraphStore.getState().lensClusterId;
    const enteringFromOutside = previousCluster !== config.clusterId;
    setLensCluster(config.clusterId);
    if (!enteringFromOutside) return;

    let cancelled = false;
    let attempts = 0;
    const tryFocus = () => {
      if (cancelled) return;
      if (apiRef.current) {
        apiRef.current.focusRegion(config.clusterId);
        return;
      }
      attempts += 1;
      if (attempts < FOCUS_MAX_ATTEMPTS) setTimeout(tryFocus, FOCUS_RETRY_MS);
    };
    tryFocus();
    return () => {
      cancelled = true;
    };
    // Re-run only when the lens itself changes — setLensCluster is a stable
    // zustand action reference.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.clusterId]);

  return (
    <div className="grid h-full min-h-[560px] grid-rows-[minmax(420px,1fr)_auto] gap-3 p-3">
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[minmax(0,1fr)_19rem]">
        <div className="relative min-h-[420px] overflow-hidden rounded-xl border border-[--canvas-card-border] bg-[#01040a]">
          <NeuralLens apiRef={apiRef} />
          <div className="pointer-events-none absolute left-4 top-4 z-20 flex items-center gap-2 rounded-md border border-white/10 bg-black/55 px-2.5 py-1 text-[9px] font-medium uppercase tracking-wide text-white/70 backdrop-blur-md">
            <span
              className={cn("h-1.5 w-1.5 rounded-full", connected ? "bg-emerald-400 shadow-[0_0_8px_#34d399]" : "bg-amber-400")}
              aria-hidden
            />
            {connected ? "Live · Connected" : "Live · Reconnecting"}
          </div>
        </div>

        <aside className="flex flex-col gap-3 overflow-y-auto lg:max-h-full">
          <Panel title="Lens Status" icon={Gauge}>
            {!stats ? (
              <Empty>No workspace data.</Empty>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {stats.statusItems.map((item) => (
                  <div key={item.label} className="rounded-md border border-[--border] px-2 py-1.5">
                    <div className="text-[15px] font-semibold text-[--canvas-foreground]">{item.value}</div>
                    <div className="text-[10px] text-[--muted-foreground]">{item.label}</div>
                  </div>
                ))}
              </div>
            )}
          </Panel>

          <Panel title="Active Runs" icon={Activity}>
            {!stats || stats.activeRuns.length === 0 ? (
              <Empty>Nothing currently in progress.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {stats.activeRuns.map((run) => (
                  <li key={run.id} className="flex items-start gap-2 text-xs">
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" aria-hidden />
                    <span className="min-w-0">
                      <span className="block truncate text-[--canvas-foreground]">{run.label}</span>
                      <span className="text-[10px] text-[--muted-foreground]">{run.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>

          <Panel title="Alerts" icon={AlertTriangle}>
            {!stats || stats.alerts.length === 0 ? (
              <Empty>No open alerts.</Empty>
            ) : (
              <ul className="space-y-1.5">
                {stats.alerts.map((alert) => (
                  <li key={alert.id} className="flex items-start gap-2 text-xs">
                    <span
                      className={cn(
                        "mt-1 h-1.5 w-1.5 shrink-0 rounded-full",
                        alert.severity === "critical" ? "bg-red-400" : "bg-amber-400",
                      )}
                      aria-hidden
                    />
                    <span className="min-w-0">
                      <span className="block truncate text-[--canvas-foreground]">{alert.label}</span>
                      <span className="text-[10px] text-[--muted-foreground]">{alert.detail}</span>
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </Panel>
        </aside>
      </div>

      <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(20rem,0.75fr)]">
        <Panel title="Recent Changes" icon={History}>
          {!stats || stats.recentChanges.length === 0 ? (
            <Empty>No recent activity in this workspace.</Empty>
          ) : (
            <div className="flex flex-wrap gap-2">
              {stats.recentChanges.map((change) => (
                <div
                  key={change.id}
                  className="flex items-center gap-2 rounded-md border border-[--border] bg-[--background]/40 px-2.5 py-1.5 text-[11px]"
                >
                  <span className="text-[--canvas-foreground]">{change.label}</span>
                  {change.detail ? <span className="text-[--muted-foreground]">· {change.detail}</span> : null}
                  <span className="text-[--muted-foreground]">· {relativeTime(change.at)}</span>
                </div>
              ))}
            </div>
          )}
        </Panel>
        <TraceReplayPanel />
      </div>
    </div>
  );
}
