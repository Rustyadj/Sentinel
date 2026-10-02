"use client";

import { useEffect, useRef, useState } from "react";
import { Maximize2, Minus, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { GlobeRenderer, type GlobeAgent } from "./globe-renderer";

export interface GlobeStageProps {
  agents: GlobeAgent[];
  followId: string | null;
  onFollowChange: (agentId: string | null) => void;
  /** Dim the globe so a foreground conversation reads clearly. */
  dimmed?: boolean;
  /** Pixels the globe is shifted right to clear overlaid panels. */
  offsetX?: number;
  className?: string;
  children?: React.ReactNode;
}

/**
 * The Orrery: Sentinel's knowledge graph as a living globe. Children render
 * above the canvas and are excluded from drag/zoom through `data-orrery-ui`.
 */
export function GlobeStage({ agents, followId, onFollowChange, dimmed, offsetX = 0, className, children }: GlobeStageProps) {
  const hostRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<GlobeRenderer | null>(null);
  const offsetRef = useRef(offsetX);
  const followCb = useRef(onFollowChange);
  const [lens, setLens] = useState(-1);
  const [lensLabel, setLensLabel] = useState<string | null>(null);

  useEffect(() => { offsetRef.current = offsetX; }, [offsetX]);
  useEffect(() => { followCb.current = onFollowChange; }, [onFollowChange]);

  useEffect(() => {
    const host = hostRef.current, canvas = canvasRef.current;
    if (!host || !canvas) return;
    const renderer = new GlobeRenderer(canvas, host, {
      offsetX: () => offsetRef.current,
      scale: 0.36,
      onFollowChange: (id) => followCb.current(id),
      onLensChange: (i) => { setLens(i); setLensLabel(i >= 0 ? renderer.regionLabels[i].label : null); },
    });
    rendererRef.current = renderer;
    return () => { renderer.destroy(); rendererRef.current = null; };
  }, []);

  useEffect(() => { rendererRef.current?.setAgents(agents); }, [agents]);
  useEffect(() => { rendererRef.current?.setFollow(followId); }, [followId]);

  const followed = agents.find((a) => a.id === followId);

  return (
    <div ref={hostRef} className={cn("relative h-full w-full touch-none select-none overflow-hidden bg-[--canvas]", className)}>
      <canvas
        ref={canvasRef}
        aria-label="Knowledge graph globe"
        role="img"
        className={cn("absolute inset-0 h-full w-full transition-opacity duration-300", dimmed ? "opacity-40" : "opacity-100")}
      />
      <div className="pointer-events-none absolute inset-0 bg-[linear-gradient(90deg,rgba(1,4,10,.72)_0,rgba(1,4,10,.35)_520px,transparent_760px),linear-gradient(270deg,rgba(1,4,10,.6)_0,transparent_360px)] max-lg:bg-[rgba(1,4,10,.6)]" />
      {children}

      <div data-orrery-ui className="absolute bottom-4 right-4 z-10 flex flex-col items-end gap-2 max-xl:right-3">
        {lensLabel ? (
          <Chip color="var(--lens)" label={`Lens · ${lensLabel}`} onClear={() => rendererRef.current?.setLens(-1)} />
        ) : null}
        {followed ? (
          <Chip color={followed.color} label={`Following ${followed.name}`} onClear={() => onFollowChange(null)} />
        ) : null}
        <div className="flex flex-col overflow-hidden rounded-lg border border-[--glass-border] bg-[--glass] backdrop-blur">
          <ZoomButton label="Zoom in" onClick={() => rendererRef.current?.zoomBy(1.25)}><Plus className="h-3.5 w-3.5" /></ZoomButton>
          <ZoomButton label="Zoom out" onClick={() => rendererRef.current?.zoomBy(0.8)}><Minus className="h-3.5 w-3.5" /></ZoomButton>
          <ZoomButton label="Reset view" onClick={() => { rendererRef.current?.reset(); onFollowChange(null); }}><Maximize2 className="h-3.5 w-3.5" /></ZoomButton>
        </div>
      </div>
      <span className="sr-only" data-lens={lens} />
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
      className="flex h-8 w-8 items-center justify-center text-[--muted-foreground] transition-colors hover:bg-[--muted] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
    >
      {children}
    </button>
  );
}

function Chip({ color, label, onClear }: { color: string; label: string; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 rounded-lg border border-[--glass-border] bg-[--glass] py-1.5 pl-3 pr-1.5 text-[12px] backdrop-blur">
      <i className="h-1.5 w-1.5 rounded-full" style={{ background: color }} />
      <span>{label}</span>
      <button type="button" aria-label="Clear" onClick={onClear} className="flex h-5 w-5 items-center justify-center rounded text-[--muted-foreground] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]">
        <X className="h-3 w-3" />
      </button>
    </div>
  );
}
