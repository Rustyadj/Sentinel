"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EDGE_BASE,
  EDGE_HIGHLIGHT,
  LENS_BG,
  PARTICLE_COLOR,
  nodeColor,
  zoomLevelFor,
  type SemanticZoomLevel,
} from "./palette";
import { rotatePositions } from "./radialLayout";
import type { LensGraph, LensLink, LensNode } from "./types";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center text-xs text-white/40">
      Charting neural space…
    </div>
  ),
});

interface NeuralLensGraphProps {
  graph: LensGraph;
  activeNodeIds: Set<string>;
  onSelect: (node: LensNode | null) => void;
  onZoomLevel?: (level: SemanticZoomLevel) => void;
  paused?: boolean;
}

function endpointId(end: unknown): string | null {
  if (typeof end === "string") return end;
  if (end && typeof end === "object" && "id" in end) return String((end as { id: unknown }).id);
  return null;
}

export function NeuralLensGraph({
  graph,
  activeNodeIds,
  onSelect,
  onZoomLevel,
  paused,
}: NeuralLensGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const zoomLevelRef = useRef<SemanticZoomLevel>("galaxy");

  // Fixed-position radial layout: fx/fy pin each node so the constellation
  // keeps its dandelion shape instead of collapsing under force simulation.
  const data = useMemo(() => {
    const nodes = graph.nodes.map((n) => ({ ...n, fx: n.x, fy: n.y }));
    const links = graph.links.map((l) => ({ ...l }));
    return { nodes, links };
  }, [graph]);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setDims({ width: el.clientWidth, height: el.clientHeight }));
    ro.observe(el);
    setDims({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Fit the whole constellation into view once it has mounted + sized.
  useEffect(() => {
    if (dims.width === 0) return;
    const t = setTimeout(() => fgRef.current?.zoomToFit?.(600, 80), 250);
    return () => clearTimeout(t);
  }, [dims.width, graph]);

  // Slow rotation drift — the "living constellation" feel. Rotates the fixed
  // positions about the origin; respects reduced-motion and tab visibility.
  useEffect(() => {
    if (paused || typeof window === "undefined") return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduce) return;
    let raf = 0;
    let last = performance.now();
    const loop = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      if (document.visibilityState === "visible") {
        const nodes = data.nodes as Array<{ fx: number; fy: number; x?: number; y?: number }>;
        rotatePositions(nodes as Array<{ x: number; y: number }>, dt * 0.02);
        // rotatePositions mutates x/y; mirror into the pinned fx/fy the sim reads.
        for (const n of nodes as Array<{ fx: number; fy: number; x: number; y: number }>) {
          n.fx = n.x;
          n.fy = n.y;
        }
        fgRef.current?.d3ReheatSimulation?.();
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [data.nodes, paused]);

  const neighborIds = useMemo(() => {
    if (!hoveredId) return null;
    const set = new Set<string>([hoveredId]);
    for (const l of graph.links) {
      if (l.source === hoveredId) set.add(l.target);
      if (l.target === hoveredId) set.add(l.source);
    }
    return set;
  }, [hoveredId, graph.links]);

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as LensNode & { x: number; y: number };
      const isHub = n.val >= 6;
      const dim = neighborIds != null && !neighborIds.has(n.id);
      const color = nodeColor(n.type, !!n.accent, isHub);
      const active = activeNodeIds.has(n.id);

      const pulse = active ? 1 + Math.sin(Date.now() * 0.006) * 0.4 : 1;
      const r = (n.val * pulse) / Math.max(0.4, globalScale) + (isHub ? 0.6 : 0);

      ctx.save();
      ctx.globalAlpha = dim ? 0.12 : 1;
      if (active || isHub) {
        ctx.shadowColor = color;
        ctx.shadowBlur = (active ? 16 : 6) / globalScale;
      }
      ctx.beginPath();
      ctx.arc(n.x, n.y, r, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      if (isHub) {
        ctx.globalAlpha = dim ? 0.1 : 0.5;
        ctx.lineWidth = 0.6 / globalScale;
        ctx.strokeStyle = color;
        ctx.beginPath();
        ctx.arc(n.x, n.y, r + 2 / globalScale, 0, Math.PI * 2);
        ctx.stroke();
      }
      ctx.restore();

      // Semantic-zoom label reveal: hubs first, then children, then everything.
      const level = zoomLevelRef.current;
      const showLabel =
        (isHub && (level === "cluster" || level === "neighborhood" || level === "detail")) ||
        (!isHub && n.val >= 2.4 && (level === "neighborhood" || level === "detail")) ||
        level === "detail";
      if (showLabel && !dim) {
        const label = n.label.length > 18 ? n.label.slice(0, 18) + "…" : n.label;
        ctx.font = `${(isHub ? 11 : 9) / globalScale}px ui-sans-serif, system-ui`;
        ctx.fillStyle = isHub ? "#e8eef7" : "rgba(220,230,245,0.7)";
        ctx.textAlign = "center";
        ctx.fillText(label, n.x, n.y - r - 4 / globalScale);
      }
    },
    [activeNodeIds, neighborIds],
  );

  const linkColor = useCallback(
    (link: object) => {
      const l = link as LensLink;
      if (!neighborIds) return EDGE_BASE;
      const s = endpointId((l as unknown as { source: unknown }).source);
      const t = endpointId((l as unknown as { target: unknown }).target);
      return (s && neighborIds.has(s)) || (t && neighborIds.has(t)) ? EDGE_HIGHLIGHT : EDGE_BASE;
    },
    [neighborIds],
  );

  const handleClick = useCallback(
    (node: object) => {
      const n = node as LensNode & { x: number; y: number };
      onSelect(n);
      fgRef.current?.centerAt?.(n.x, n.y, 700);
      fgRef.current?.zoom?.(Math.max(2.6, 3), 700);
    },
    [onSelect],
  );

  return (
    <div ref={containerRef} className="absolute inset-0 h-full w-full">
      {dims.width > 0 && (
        <ForceGraph2D
          ref={fgRef}
          width={dims.width}
          height={dims.height}
          graphData={data}
          backgroundColor={LENS_BG}
          nodeLabel={() => ""}
          nodeCanvasObject={nodeCanvasObject}
          nodePointerAreaPaint={(node: object, color: string, ctx: CanvasRenderingContext2D) => {
            const n = node as LensNode & { x: number; y: number };
            ctx.fillStyle = color;
            ctx.beginPath();
            ctx.arc(n.x, n.y, Math.max(3, n.val), 0, Math.PI * 2);
            ctx.fill();
          }}
          linkColor={linkColor}
          linkWidth={(l: object) => {
            const link = l as LensLink;
            return 0.25 + link.weight * 0.8;
          }}
          linkCurvature={0.06}
          linkDirectionalParticles={(l: object) => {
            const s = endpointId((l as { source: unknown }).source);
            const t = endpointId((l as { target: unknown }).target);
            return activeNodeIds.size > 0 && ((s && activeNodeIds.has(s)) || (t && activeNodeIds.has(t)))
              ? 2
              : 0;
          }}
          linkDirectionalParticleWidth={1.6}
          linkDirectionalParticleColor={() => PARTICLE_COLOR}
          linkDirectionalParticleSpeed={0.006}
          enableNodeDrag={false}
          cooldownTicks={0}
          warmupTicks={0}
          onNodeHover={(node: object | null) => setHoveredId((node as LensNode | null)?.id ?? null)}
          onNodeClick={handleClick}
          onBackgroundClick={() => onSelect(null)}
          onZoom={(z: { k: number }) => {
            const level = zoomLevelFor(z.k);
            if (level !== zoomLevelRef.current) {
              zoomLevelRef.current = level;
              onZoomLevel?.(level);
            }
          }}
        />
      )}
    </div>
  );
}
