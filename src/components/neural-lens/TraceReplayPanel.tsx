"use client";

import { useEffect } from "react";
import {
  Pause,
  Play,
  RotateCcw,
  Route,
  SkipBack,
  SkipForward,
  X,
} from "lucide-react";
import { useGraphStore } from "@/store/useGraphStore";
import { cn } from "@/lib/utils";
import { relativeTime } from "./LensOverview";

const TRACE_STEP_MS = 900;

const controlClass =
  "inline-flex h-7 w-7 items-center justify-center rounded-md border border-[--border] text-[--muted-foreground] transition-colors hover:border-cyan-400/40 hover:bg-cyan-400/10 hover:text-[--canvas-foreground] disabled:cursor-not-allowed disabled:opacity-35 disabled:hover:border-[--border] disabled:hover:bg-transparent";

export function TraceReplayPanel() {
  const recentTraces = useGraphStore((state) => state.recentTraces);
  const activeTrace = useGraphStore((state) => state.activeTrace);
  const traceStepIndex = useGraphStore((state) => state.traceStepIndex);
  const tracePlaying = useGraphStore((state) => state.tracePlaying);
  const animate = useGraphStore((state) => state.graphSettings.animate);
  const selectTrace = useGraphStore((state) => state.selectTrace);
  const setTracePlaying = useGraphStore((state) => state.setTracePlaying);
  const restartTrace = useGraphStore((state) => state.restartTrace);
  const stepTrace = useGraphStore((state) => state.stepTrace);
  const advanceTrace = useGraphStore((state) => state.advanceTrace);
  const exitTrace = useGraphStore((state) => state.exitTrace);

  useEffect(() => {
    if (!tracePlaying) return;
    if (!animate) {
      setTracePlaying(false);
      return;
    }
    if (!activeTrace || traceStepIndex >= activeTrace.nodeIds.length - 1) {
      setTracePlaying(false);
      return;
    }

    const timer = window.setTimeout(advanceTrace, TRACE_STEP_MS);
    return () => window.clearTimeout(timer);
  }, [activeTrace, advanceTrace, animate, setTracePlaying, tracePlaying, traceStepIndex]);

  const atStart = traceStepIndex === 0;
  const atEnd = !activeTrace || traceStepIndex >= activeTrace.nodeIds.length - 1;

  return (
    <section className="rounded-lg border border-[--canvas-card-border] bg-[--canvas-card] p-3">
      <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-[--muted-foreground]">
        <Route className="h-3.5 w-3.5" />
        Trace Replay
      </div>

      {activeTrace ? (
        <div className="flex min-h-16 flex-col justify-between gap-2 sm:flex-row sm:items-center">
          <div className="min-w-0">
            <p className="line-clamp-2 text-xs text-[--canvas-foreground]">{activeTrace.label}</p>
            <p className="mt-1 text-[10px] text-[--muted-foreground]" aria-live="polite">
              Step {traceStepIndex + 1} of {activeTrace.nodeIds.length}
              {!animate ? " · Auto-play disabled" : ""}
            </p>
          </div>

          <div className="flex shrink-0 items-center gap-1">
            <button
              type="button"
              className={controlClass}
              onClick={restartTrace}
              aria-label="Restart trace"
              title="Restart"
            >
              <RotateCcw className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={controlClass}
              onClick={() => stepTrace(-1)}
              disabled={atStart}
              aria-label="Previous trace step"
              title="Previous"
            >
              <SkipBack className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={cn(controlClass, tracePlaying && "border-cyan-400/40 bg-cyan-400/10 text-cyan-300")}
              onClick={() => setTracePlaying(!tracePlaying)}
              disabled={!tracePlaying && (!animate || atEnd)}
              aria-label={tracePlaying ? "Pause trace" : "Play trace"}
              title={tracePlaying ? "Pause" : "Play"}
            >
              {tracePlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <button
              type="button"
              className={controlClass}
              onClick={() => stepTrace(1)}
              disabled={atEnd}
              aria-label="Next trace step"
              title="Next"
            >
              <SkipForward className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              className={controlClass}
              onClick={exitTrace}
              aria-label="Exit trace replay"
              title="Exit"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>
      ) : recentTraces.length === 0 ? (
        <p className="py-2 text-xs text-[--muted-foreground]">Waiting for multi-node activity.</p>
      ) : (
        <ul className="grid gap-1.5 sm:grid-cols-2 xl:grid-cols-3">
          {recentTraces.map((trace) => (
            <li key={trace.id}>
              <button
                type="button"
                className="flex w-full items-center justify-between gap-3 rounded-md border border-[--border] bg-[--background]/40 px-2.5 py-2 text-left transition-colors hover:border-cyan-400/35 hover:bg-cyan-400/5"
                onClick={() => selectTrace(trace)}
              >
                <span className="min-w-0 truncate text-[11px] text-[--canvas-foreground]">{trace.label}</span>
                <span className="shrink-0 text-[10px] text-[--muted-foreground]">
                  {relativeTime(new Date(trace.capturedAt))}
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
