"use client";

import { useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GlobeModel } from "@/components/orrery/globe-model";
import { STRATA, toStrataModel } from "@/components/strata/strata-model";
import { WatchRenderer, type WatchAgent, type WatchHover, type WatchInsets } from "./watch-renderer";

/** Imperative handle for pushing real events into the renderer. */
export interface WatchHandle { dispatch: (agentId: string, nodeIds: string[]) => void }

export interface StageAgent extends WatchAgent {
  /** What the agent is doing right now, in a few words. Shown only while it is working. */
  caption?: string;
}

export interface WatchStageProps {
  model: GlobeModel | null;
  /** What to say over the chart when there is nothing to draw, or the graph failed. */
  message?: string | null;
  handleRef?: React.Ref<WatchHandle>;
  agents: StageAgent[];
  /** Graph node ids the current conversation is about. */
  focusIds: string[];
  followId: string | null;
  onFollowChange: (agentId: string | null) => void;
  insets?: WatchInsets;
  /** Slow drift of every node around its seat. Always off under reduced motion. Defaults to on. */
  ambient?: boolean;
  className?: string;
  children?: React.ReactNode;
}

const NO_INSETS: WatchInsets = { left: 0, right: 0, top: 0, bottom: 0 };

/**
 * The knowledge graph as a watch. Agents stand at the centre; what they work
 * for, the work, and what is known ring them. A working agent's light turns,
 * and it casts a beam onto whatever it is touching. Children render above the
 * canvas.
 */
export function WatchStage({
  model, message, handleRef, agents, focusIds, followId, onFollowChange, insets = NO_INSETS, ambient = true, className, children,
}: WatchStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<WatchRenderer | null>(null);
  const insetsRef = useRef(insets);
  const captionRefs = useRef(new Map<string, HTMLDivElement>());
  const followRef = useRef({ followId, onFollowChange });
  const [hover, setHover] = useState<WatchHover | null>(null);
  const [pinnedId, setPinnedId] = useState<string | null>(null);
  const [emphasis, setEmphasis] = useState(-1);
  // How much room there is for words beside the lights: every agent's name,
  // only the working agents' captions, or (in a thin band) none at all.
  const [density, setDensity] = useState<"all" | "working" | "none">("all");

  const strata = useMemo(() => (model ? toStrataModel(model) : null), [model]);

  useEffect(() => { insetsRef.current = insets; }, [insets]);
  useEffect(() => { followRef.current = { followId, onFollowChange }; }, [followId, onFollowChange]);

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    const renderer = new WatchRenderer(canvas, host, {
      insets: () => insetsRef.current,
      onHover: setHover,
      onSelect: setPinnedId,
      onAgent: (agentId) => followRef.current.onFollowChange(followRef.current.followId === agentId ? null : agentId),
      // Captions are real text in the DOM, moved by the renderer without a React render per frame.
      placeLight: (agentId, x, y, outward) => {
        const el = captionRefs.current.get(agentId);
        if (!el) return;
        const left = Math.cos(outward) < -0.2;
        const dx = Math.cos(outward) * 20, dy = Math.sin(outward) * 20;
        el.style.transform = `translate(${Math.round(x + dx)}px, ${Math.round(y + dy)}px) translate(${left ? "-100%" : "0"}, -50%)`;
      },
    });
    rendererRef.current = renderer;
    return () => { renderer.destroy(); rendererRef.current = null; };
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    const measure = () => {
      const size = Math.min(host.clientWidth, host.clientHeight);
      setDensity(size < 240 ? "none" : size < 460 ? "working" : "all");
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  useImperativeHandle(handleRef, () => ({
    dispatch: (agentId, nodeIds) => rendererRef.current?.dispatch(agentId, nodeIds),
  }), []);

  // The renderer needs only identity, colour, state and node; a new caption must not move the chart.
  const agentKey = agents.map((a) => `${a.id}|${a.color}|${a.working ? 1 : 0}|${a.nodeId ?? ""}`).join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const rendererAgents = useMemo<WatchAgent[]>(() => agents.map(({ id, name, color, working, nodeId }) => ({ id, name, color, working, nodeId })), [agentKey]);

  // Model before agents and focus: both resolve against nodes that must exist.
  useEffect(() => { if (strata) rendererRef.current?.setModel(strata); }, [strata]);
  useEffect(() => { rendererRef.current?.setAgents(rendererAgents); }, [rendererAgents, strata]);
  useEffect(() => { rendererRef.current?.setFocus(focusIds); }, [focusIds, strata]);
  useEffect(() => { rendererRef.current?.setFollow(followId); }, [followId, strata]);
  useEffect(() => { rendererRef.current?.setEmphasis(emphasis); }, [emphasis]);
  useEffect(() => { rendererRef.current?.setAmbient(ambient); }, [ambient]);

  const setCaptionRef = useCallback((id: string) => (el: HTMLDivElement | null) => {
    if (el) captionRefs.current.set(id, el); else captionRefs.current.delete(id);
  }, []);

  const counts = strata?.counts ?? [0, 0, 0, 0];
  const pinnedLabel = pinnedId && strata ? strata.labels[strata.indexById.get(pinnedId) ?? -1] ?? null : null;
  const followed = agents.find((a) => a.id === followId);
  const working = agents.filter((a) => a.working);
  const summary = strata
    ? `Knowledge graph with agents at the centre: ${STRATA.map((s, i) => `${counts[i]} ${s.label.toLowerCase()}`).join(", ")}; ${strata.edgeCount} connections. ${working.length ? `${working.map((a) => a.name).join(", ")} working.` : "No agent is working."}`
    : "Knowledge graph loading.";

  return (
    <div ref={hostRef} className={cn("watch-ground relative h-full w-full touch-none select-none overflow-hidden", className)}>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label={summary}
        data-nodes={strata?.nodeCount ?? 0}
        data-edges={strata?.edgeCount ?? 0}
        className="absolute inset-0 h-full w-full cursor-grab active:cursor-grabbing"
      />

      {/* What each agent is doing, beside its light. */}
      <div className="pointer-events-none absolute inset-0 z-[1] overflow-hidden" aria-live="polite">
        {agents.map((agent) => (
          <div
            key={agent.id}
            ref={setCaptionRef(agent.id)}
            className={cn("absolute left-0 top-0 will-change-transform", (density === "none" || (density === "working" && !agent.working)) && "hidden")}
          >
            {/* On the ground colour, so the words stay readable where beams and lines pass behind them. */}
            <div className={cn("inline-block max-w-[200px] rounded-(--radius-sm) bg-(--canvas) px-1.5 py-0.5 text-left", agent.working && "border border-(--border)")}>
              <p className={cn("truncate text-[12px] font-semibold leading-tight", agent.working ? "text-(--foreground)" : "text-(--text-faint)")}>
                {agent.name}
              </p>
              {agent.working ? (
                <p className="mt-0.5 line-clamp-2 text-[11.5px] leading-snug" style={{ color: agent.color }}>
                  {agent.caption || "Working"}
                </p>
              ) : null}
            </div>
          </div>
        ))}
      </div>

      {hover ? (
        <div
          aria-hidden
          className="pointer-events-none absolute z-[2] max-w-[260px] -translate-y-full rounded-(--radius-md) border border-(--border-strong) bg-(--card) px-3 py-2 shadow-(--shadow-md)"
          style={{ left: hover.x + 14, top: hover.y - 10 }}
        >
          <p className="truncate text-[13px] font-medium text-(--foreground)">{hover.label}</p>
          <p className="text-[11.5px] text-(--muted-foreground)">{hover.type}, on the {hover.ring.toLowerCase()} ring</p>
        </div>
      ) : null}

      {message ? (
        <div className="pointer-events-none absolute inset-0 z-[1] flex items-end justify-center px-6 pb-24 text-center">
          <p className="max-w-sm rounded-(--radius-md) border border-(--border) bg-(--panel) px-4 py-2.5 text-[13px] leading-relaxed text-(--muted-foreground)">{message}</p>
        </div>
      ) : null}

      {children}

      <div data-watch-ui className="absolute bottom-3 right-3 z-[4] flex flex-col items-end gap-2">
        {pinnedLabel ? (
          <Chip tone="var(--primary)" label={`Pinned: ${pinnedLabel}`} onClear={() => { rendererRef.current?.clearPin(); setPinnedId(null); }} />
        ) : null}
        {followed ? <Chip tone={followed.color} label={`Following ${followed.name}`} onClear={() => onFollowChange(null)} /> : null}
        <div className="flex items-end gap-2">
          {/* Ring key: names each ring from the centre out, counts what is on it, and lights one at a time. */}
          <div role="group" aria-label="Graph rings" className="hidden overflow-hidden rounded-(--radius-md) border border-(--border) bg-(--panel) py-1 sm:block">
            {STRATA.map((s, i) => {
              const on = emphasis === i;
              return (
                <button
                  key={s.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => setEmphasis(on ? -1 : i)}
                  title={on ? "Show every ring" : `Light the ${s.label.toLowerCase()} ring`}
                  className={cn(
                    "flex h-7 w-full items-center gap-2.5 px-3 text-left text-[12px] transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--ring)",
                    on ? "bg-(--accent) text-(--foreground)" : "text-(--muted-foreground) hover:text-(--foreground)",
                  )}
                >
                  <span aria-hidden className="h-2 w-2 rounded-full" style={{ background: `var(${s.token})`, opacity: emphasis < 0 || on ? 1 : 0.35 }} />
                  <span className="w-16">{s.label}</span>
                  <span className="min-w-[2ch] text-right font-mono text-[10.5px] tabular-nums text-(--text-faint)">{counts[i]}</span>
                </button>
              );
            })}
          </div>
          <div className="flex flex-col overflow-hidden rounded-(--radius-md) border border-(--border) bg-(--panel)">
            <ZoomButton label="Zoom in" onClick={() => rendererRef.current?.zoomBy(1.25)}><Plus className="h-3.5 w-3.5" /></ZoomButton>
            <ZoomButton label="Zoom out" onClick={() => rendererRef.current?.zoomBy(0.8)}><Minus className="h-3.5 w-3.5" /></ZoomButton>
            <ZoomButton label="Reset view" onClick={() => { rendererRef.current?.reset(); setPinnedId(null); setEmphasis(-1); onFollowChange(null); }}><Maximize2 className="h-3.5 w-3.5" /></ZoomButton>
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
      className="flex h-9 w-9 items-center justify-center text-(--muted-foreground) transition-colors hover:bg-(--accent) hover:text-(--foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-(--ring)"
    >
      {children}
    </button>
  );
}

function Chip({ tone, label, onClear }: { tone: string; label: string; onClear: () => void }) {
  return (
    <div className="flex max-w-[280px] items-center gap-2 rounded-full border border-(--border) bg-(--panel) py-1 pl-3 pr-1 text-[12px]">
      <i aria-hidden className="h-2 w-2 shrink-0 rounded-full" style={{ background: tone }} />
      <span className="truncate">{label}</span>
      <button type="button" aria-label={`Clear: ${label}`} onClick={onClear} className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-(--muted-foreground) hover:bg-(--accent) hover:text-(--foreground) focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
