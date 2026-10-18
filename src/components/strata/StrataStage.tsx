"use client";

import { useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GlobeModel } from "@/components/orrery/globe-model";
import { STRATA, toStrataModel } from "./strata-model";
import { StrataRenderer, type StrataAgent, type StrataHover, type StrataInsets } from "./strata-renderer";

/** Imperative handle for pushing real events into the renderer. */
export interface StrataHandle { dispatch: (agentId: string, nodeIds: string[]) => void }

export interface StrataStageProps {
  model: GlobeModel | null;
  /** What to say over the strata when there is nothing to draw, or the graph failed. */
  message?: string | null;
  handleRef?: React.Ref<StrataHandle>;
  agents: StrataAgent[];
  /** Graph node ids the current conversation is about. */
  focusIds: string[];
  followId: string | null;
  onFollowChange: (agentId: string | null) => void;
  /** Quiet the strata so a foreground conversation reads clearly. */
  dimmed?: boolean;
  /** Screen area covered by foreground panels, so the strata centre in what is left. */
  insets: StrataInsets;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The knowledge graph as stacked strata — agents above the projects they
 * serve, tasks below those, memory at the base — drawn behind the
 * conversation. Children render above the canvas.
 */
export function StrataStage({
  model, message, handleRef, agents, focusIds, followId, onFollowChange, dimmed, insets, className, children,
}: StrataStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<StrataRenderer | null>(null);
  const insetsRef = useRef(insets);
  const [hover, setHover] = useState<StrataHover | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [emphasis, setEmphasis] = useState(-1);

  const strata = useMemo(() => (model ? toStrataModel(model) : null), [model]);

  useEffect(() => { insetsRef.current = insets; }, [insets]);

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    const renderer = new StrataRenderer(canvas, host, {
      insets: () => insetsRef.current,
      onHover: setHover,
      onSelect: setPinnedId,
    });
    rendererRef.current = renderer;
    return () => { renderer.destroy(); rendererRef.current = null; };
  }, []);

  useImperativeHandle(handleRef, () => ({
    dispatch: (agentId, nodeIds) => rendererRef.current?.dispatch(agentId, nodeIds),
  }), []);

  // Model before agents and focus: both resolve against nodes that must exist.
  useEffect(() => { if (strata) rendererRef.current?.setModel(strata); }, [strata]);
  useEffect(() => { rendererRef.current?.setAgents(agents); }, [agents, strata]);
  useEffect(() => { rendererRef.current?.setFocus(focusIds); }, [focusIds, strata]);
  useEffect(() => { rendererRef.current?.setFollow(followId); }, [followId, strata]);
  useEffect(() => { rendererRef.current?.setEmphasis(emphasis); }, [emphasis]);

  const counts = strata?.counts ?? [0, 0, 0, 0];
  const pinnedLabel = pinnedId && strata ? strata.labels[strata.indexById.get(pinnedId) ?? -1] ?? null : null;
  const followed = agents.find((a) => a.id === followId);
  const summary = strata
    ? `Knowledge graph in four strata: ${STRATA.map((s, i) => `${counts[i]} ${s.label.toLowerCase()}`).join(", ")}; ${strata.edgeCount} connections.`
    : "Knowledge graph loading.";

  return (
    <div ref={hostRef} className={cn("strata-ground relative h-full w-full touch-none select-none overflow-hidden", className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={summary}
        data-nodes={strata?.nodeCount ?? 0}
        data-edges={strata?.edgeCount ?? 0}
        className={cn(
          "absolute inset-0 h-full w-full transition-opacity duration-300 motion-reduce:transition-none",
          dimmed ? "opacity-30" : "opacity-100",
        )}
      />

      {hover && !dimmed ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[2] max-w-[240px] -translate-y-full rounded-md border border-(--border-strong) bg-(--glass-strong) px-2.5 py-1.5 shadow-[var(--shadow-md)]"
          style={{ left: hover.x + 12, top: hover.y - 8 }}
        >
          <p className="truncate text-[13px] font-medium text-(--foreground)">{hover.label}</p>
          <p className="text-[11px] text-(--muted-foreground)">{hover.type} · {hover.stratum}</p>
        </div>
      ) : null}

      {message ? (
        <div
          className="pointer-events-none absolute z-[1] flex items-center justify-center px-6 text-center"
          style={{ left: insets.left, right: insets.right, top: insets.top, bottom: insets.bottom }}
        >
          <p className="max-w-xs rounded-md bg-(--glass) px-3 py-2 text-[13px] leading-relaxed text-(--muted-foreground)">{message}</p>
        </div>
      ) : null}

      {children}

      {/* Stratum key: names each layer, counts what is really on it, and lets
          the operator light one layer at a time. */}
      <div
        data-strata-ui
        className={cn(
          "absolute z-[4] flex flex-col items-end gap-2 transition-opacity duration-200",
          dimmed && "pointer-events-none opacity-0",
        )}
        style={{ right: insets.right + 12, bottom: insets.bottom + 12 }}
      >
        {pinnedLabel ? (
          <Chip tone="var(--primary)" label={`Pinned · ${pinnedLabel}`} onClear={() => { rendererRef.current?.clearPin(); setPinnedId(null); }} />
        ) : null}
        {followed ? (
          <Chip tone={followed.color} label={`Following ${followed.name}`} onClear={() => onFollowChange(null)} />
        ) : null}
        <div className="flex items-end gap-2">
          <div role="group" aria-label="Graph layers" className="flex flex-col overflow-hidden rounded-md border border-(--glass-border) bg-(--glass) py-1">
            {STRATA.map((s, i) => {
              const on = emphasis === i;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setEmphasis(on ? -1 : i)}
                  title={on ? `Show all layers` : `Highlight ${s.label.toLowerCase()}`}
                  className={cn(
                    "flex h-7 items-center gap-2.5 px-2.5 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--ring)",
                    on ? "bg-(--muted) text-(--foreground)" : "text-(--muted-foreground) hover:text-(--foreground)",
                  )}
                >
                  <span aria-hidden className="h-[3px] w-3 rounded-full" style={{ background: `var(${s.token})`, opacity: emphasis < 0 || on ? 1 : 0.35 }} />
                  <span className="w-16">{s.label}</span>
                  <span className="min-w-[2ch] text-right font-mono text-[11px] tabular-nums text-(--text-faint)">{counts[i]}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col overflow-hidden rounded-md border border-(--glass-border) bg-(--glass)">
            <ZoomButton label="Zoom in" onClick={() => rendererRef.current?.zoomBy(1.2)}><Plus className="h-3.5 w-3.5" /></ZoomButton>
            <ZoomButton label="Zoom out" onClick={() => rendererRef.current?.zoomBy(0.83)}><Minus className="h-3.5 w-3.5" /></ZoomButton>
            <ZoomButton label="Reset view" onClick={() => { rendererRef.current?.reset(); setEmphasis(-1); onFollowChange(null); }}><Maximize2 className="h-3.5 w-3.5" /></ZoomButton>
          </div>
        </div>
      </div>
    </div>
  );
}

function ZoomButton({ label, onClick, children }: { label: string; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="flex h-8 w-8 items-center justify-center text-(--muted-foreground) transition-colors hover:bg-(--muted) hover:text-(--foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--ring)"
    >
      {children}
    </button>
  );
}

function Chip({ tone, label, onClear }: { tone: string; label: string; onClear: () => void }) {
  return (
    <div className="flex max-w-[280px] items-center gap-2 rounded-md border border-(--glass-border) bg-(--glass) py-1 pl-2.5 pr-1 text-[12px]">
      <i aria-hidden className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: tone }} />
      <span className="truncate">{label}</span>
      <button type="button" aria-label={`Clear: ${label}`} onClick={onClear} className="flex h-6 w-6 shrink-0 items-center justify-center rounded text-(--muted-foreground) hover:bg-(--muted) hover:text-(--foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
