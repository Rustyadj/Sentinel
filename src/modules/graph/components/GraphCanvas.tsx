"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import dynamic from "next/dynamic";
import { clusterColor, clusterOf, edgeWidth, nodeRadius, recencyIntensity } from "@/lib/graph/semantics";
import type { ScopedGraph, ScopedNode } from "./useGraphData";

const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => <p className="p-6 text-[13px] text-[--muted-foreground]">Preparing canvas…</p>,
});

interface CanvasNode {
  id: string;
  label: string;
  color: string;
  radius: number;
  glow: number;
  degree: number;
  truncatedDegree: number;
  x?: number;
  y?: number;
  [key: string]: unknown;
}

interface CanvasLink {
  source: string | CanvasNode;
  target: string | CanvasNode;
  width: number;
  strength: number;
  [key: string]: unknown;
}

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", onChange);
  return () => query.removeEventListener("change", onChange);
}

/** Read the user's motion preference as an external store, so it is never state
 *  synchronised from an effect and is correct on the very first paint. */
function useReducedMotion() {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia(REDUCED_MOTION_QUERY).matches,
    () => false,
  );
}

/**
 * The graph canvas: soft light ground, glowing nodes, curved links.
 *
 * Everything drawn is derived from real relationships — size from connections,
 * glow from recency, thickness from edge weight, colour from the entity's
 * semantic cluster. Motion is suppressed entirely under prefers-reduced-motion.
 */
export function GraphCanvas({ graph, focusId, selectedId, onSelect, onExpand }: {
  graph: ScopedGraph;
  focusId: string | null;
  selectedId: string | null;
  onSelect: (node: ScopedNode) => void;
  onExpand: (nodeId: string) => void;
}) {
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const graphRef = useRef<any>(undefined);
  const [size, setSize] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const reducedMotion = useReducedMotion();

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const data = useMemo(() => {
    const nodes: CanvasNode[] = graph.nodes.map((node) => ({
      id: node.id,
      label: node.title,
      color: clusterColor(clusterOf(node.type)),
      radius: nodeRadius(node.degree, node.id === focusId),
      glow: recencyIntensity(node.createdAt),
      degree: node.degree,
      truncatedDegree: node.truncatedDegree,
    }));
    const present = new Set(nodes.map((node) => node.id));
    const links: CanvasLink[] = graph.edges
      .filter((edge) => present.has(edge.fromObjectId) && present.has(edge.toObjectId))
      .map((edge) => ({
        source: edge.fromObjectId,
        target: edge.toObjectId,
        width: edgeWidth(edge.weight),
        strength: Math.min(Math.max(edge.weight, 0), 1),
      }));
    return { nodes, links };
  }, [graph, focusId]);

  const nodeById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);

  // Re-centre when the focus changes rather than on every data mutation.
  useEffect(() => {
    if (!graphRef.current || data.nodes.length === 0) return;
    const timer = setTimeout(() => graphRef.current?.zoomToFit(reducedMotion ? 0 : 500, 80), 320);
    return () => clearTimeout(timer);
  }, [focusId, data.nodes.length, reducedMotion]);

  const paintNode = useCallback((node: CanvasNode, ctx: CanvasRenderingContext2D, scale: number) => {
    const radius = node.radius;
    const active = node.id === selectedId || node.id === focusId;
    const hovered = node.id === hoveredId;

    if (node.glow > 0.05) {
      const halo = ctx.createRadialGradient(node.x!, node.y!, radius * 0.4, node.x!, node.y!, radius * 3);
      halo.addColorStop(0, `${node.color}${Math.round(node.glow * 60).toString(16).padStart(2, "0")}`);
      halo.addColorStop(1, "transparent");
      ctx.fillStyle = halo;
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, radius * 3, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.beginPath();
    ctx.arc(node.x!, node.y!, radius, 0, Math.PI * 2);
    ctx.fillStyle = node.color;
    ctx.globalAlpha = active || hovered ? 1 : 0.88;
    ctx.fill();
    ctx.globalAlpha = 1;

    if (active) {
      ctx.beginPath();
      ctx.arc(node.x!, node.y!, radius + 3, 0, Math.PI * 2);
      ctx.strokeStyle = node.color;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }

    // A node with unloaded neighbours is marked, so "no visible edges" never
    // reads as "nothing connected here".
    if (node.truncatedDegree > 0 && scale > 0.6) {
      ctx.beginPath();
      ctx.arc(node.x! + radius * 0.85, node.y! - radius * 0.85, 2, 0, Math.PI * 2);
      ctx.fillStyle = "var(--muted-foreground)";
      ctx.fillStyle = "#9a968e";
      ctx.fill();
    }

    if (scale > 1.1 || active || hovered) {
      const fontSize = Math.max(11 / scale, 3);
      ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "top";
      ctx.fillStyle = "#3f3d38";
      const label = node.label.length > 34 ? `${node.label.slice(0, 33)}…` : node.label;
      ctx.fillText(label, node.x!, node.y! + radius + 3 / scale);
    }
  }, [selectedId, focusId, hoveredId]);

  if (size.width === 0 || size.height === 0) {
    return <div ref={containerRef} className="h-full w-full" />;
  }

  return (
    <div ref={containerRef} className="h-full w-full">
      <ForceGraph2D
        ref={graphRef}
        width={size.width}
        height={size.height}
        graphData={data}
        backgroundColor="rgba(0,0,0,0)"
        nodeRelSize={1}
        nodeCanvasObject={paintNode as never}
        nodePointerAreaPaint={((node: CanvasNode, color: string, ctx: CanvasRenderingContext2D) => {
          ctx.fillStyle = color;
          ctx.beginPath();
          ctx.arc(node.x!, node.y!, node.radius + 4, 0, Math.PI * 2);
          ctx.fill();
        }) as never}
        linkColor={() => "rgba(120,116,108,0.28)"}
        linkWidth={((link: CanvasLink) => link.width) as never}
        linkCurvature={0.18}
        linkDirectionalParticles={reducedMotion ? 0 : 2}
        linkDirectionalParticleWidth={((link: CanvasLink) => (link.strength > 0.6 ? 1.6 : 0)) as never}
        linkDirectionalParticleSpeed={0.004}
        cooldownTicks={reducedMotion ? 0 : 90}
        enableNodeDrag={!reducedMotion}
        onNodeHover={((node: CanvasNode | null) => setHoveredId(node?.id ?? null)) as never}
        onNodeClick={((node: CanvasNode) => {
          const scoped = nodeById.get(node.id);
          if (scoped) onSelect(scoped);
          if (node.truncatedDegree > 0) onExpand(node.id);
        }) as never}
      />
    </div>
  );
}
