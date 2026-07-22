"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  EDGE_BASE,
  EDGE_HIGHLIGHT,
  LENS_BG,
  PARTICLE_COLOR,
  nodeColor,
  type SemanticZoomLevel,
} from "./palette";
import type { LensGraph, LensLink, LensNode } from "./types";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-[11px] text-white/35">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" />
      Mapping neural space…
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

type LensNode3D = LensNode & {
  z: number;
  fx: number;
  fy: number;
  fz: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  driftPhase: number;
  driftScale: number;
};

function endpointId(end: unknown): string | null {
  if (typeof end === "string") return end;
  if (end && typeof end === "object" && "id" in end) {
    return String((end as { id: unknown }).id);
  }
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
  // react-force-graph exposes an imperative Three.js camera surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const data = useMemo(() => {
    const nodes: LensNode3D[] = graph.nodes.map((node, index) => {
      const z = Math.sin(index * 1.618) * 128 + Math.cos(index * 0.371) * 44;
      return {
        ...node,
        z,
        fx: node.x,
        fy: node.y,
        fz: z,
        baseX: node.x,
        baseY: node.y,
        baseZ: z,
        driftPhase: index * 0.731,
        driftScale: node.val >= 6 ? 1.5 : 3 + (index % 7) * 0.42,
      };
    });
    return { nodes, links: graph.links.map((link) => ({ ...link })) };
  }, [graph]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(() => {
      setDims({ width: element.clientWidth, height: element.clientHeight });
    });
    resizeObserver.observe(element);
    setDims({ width: element.clientWidth, height: element.clientHeight });
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (dims.width === 0) return;
    const timer = setTimeout(() => {
      fgRef.current?.cameraPosition?.(
        { x: 0, y: 0, z: 1100 },
        { x: 0, y: 0, z: 0 },
        950,
      );
      fgRef.current?.refresh?.();
      onZoomLevel?.("galaxy");
    }, 650);
    return () => clearTimeout(timer);
  }, [dims.width, graph, onZoomLevel]);

  // Independent, very slow offsets keep the network alive without turning the
  // entire structure into a rigid orbit. Motion stops for reduced-motion users.
  useEffect(() => {
    if (paused || typeof window === "undefined") return;
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (document.visibilityState === "visible" && now - last >= 70) {
        last = now;
        const seconds = now / 1000;
        for (const node of data.nodes) {
          const phase = node.driftPhase;
          const scale = node.driftScale;
          node.fx = node.baseX + Math.sin(seconds * 0.13 + phase) * scale + Math.sin(seconds * 0.041 + phase * 1.7) * scale * 0.45;
          node.fy = node.baseY + Math.cos(seconds * 0.11 + phase * 1.13) * scale + Math.sin(seconds * 0.053 + phase * 0.8) * scale * 0.4;
          node.fz = node.baseZ + Math.sin(seconds * 0.09 + phase * 1.43) * scale * 0.75;
          node.x = node.fx;
          node.y = node.fy;
          node.z = node.fz;
        }
        fgRef.current?.refresh?.();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [data.nodes, paused]);

  const neighborIds = useMemo(() => {
    if (!hoveredId) return null;
    const neighbors = new Set<string>([hoveredId]);
    for (const link of graph.links) {
      if (link.source === hoveredId) neighbors.add(link.target);
      if (link.target === hoveredId) neighbors.add(link.source);
    }
    return neighbors;
  }, [graph.links, hoveredId]);

  const handleClick = useCallback(
    (node: object) => {
      const selected = node as LensNode3D;
      onSelect(selected);
      onZoomLevel?.("detail");
      const length = Math.hypot(selected.x, selected.y, selected.z) || 1;
      const ratio = 1 + 105 / length;
      fgRef.current?.cameraPosition?.(
        {
          x: selected.x * ratio,
          y: selected.y * ratio,
          z: selected.z * ratio + (length < 12 ? 105 : 0),
        },
        { x: selected.x, y: selected.y, z: selected.z },
        850,
      );
    },
    [onSelect, onZoomLevel],
  );

  return (
    <div
      ref={containerRef}
      className="neural-space-canvas absolute inset-0 h-full w-full overflow-hidden"
      role="application"
      aria-label="Knowledge graph canvas"
    >
      {dims.width > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={dims.width}
          height={dims.height}
          graphData={data}
          backgroundColor={LENS_BG}
          showNavInfo={false}
          controlType="orbit"
          numDimensions={3}
          nodeLabel={(node: object) => {
            const typed = node as LensNode3D;
            return typed.val >= 3 ? typed.label : "";
          }}
          nodeVal={(node: object) => {
            const typed = node as LensNode3D;
            if (activeNodeIds.has(typed.id)) return Math.max(typed.val * 1.8, 4);
            return typed.val >= 6 ? 5.4 : Math.max(0.32, typed.val * 0.48);
          }}
          nodeColor={(node: object) => {
            const typed = node as LensNode3D;
            if (neighborIds && !neighborIds.has(typed.id)) return "#0a1420";
            if (activeNodeIds.has(typed.id)) return PARTICLE_COLOR;
            return nodeColor(typed.type, !!typed.accent, typed.val >= 6);
          }}
          nodeRelSize={1.45}
          nodeOpacity={0.92}
          nodeResolution={8}
          linkColor={(link: object) => {
            const typed = link as LensLink & { source: unknown; target: unknown };
            if (!neighborIds) return "#4a79ad";
            const source = endpointId(typed.source);
            const target = endpointId(typed.target);
            return (source && neighborIds.has(source)) || (target && neighborIds.has(target))
              ? EDGE_HIGHLIGHT
              : EDGE_BASE;
          }}
          linkOpacity={0.23}
          linkWidth={(link: object) => 0.12 + (link as LensLink).weight * 0.42}
          linkCurvature={() => 0}
          linkDirectionalParticles={(link: object) => {
            const typed = link as { source: unknown; target: unknown };
            const source = endpointId(typed.source);
            const target = endpointId(typed.target);
            return activeNodeIds.size > 0 && ((source && activeNodeIds.has(source)) || (target && activeNodeIds.has(target))) ? 1 : 0;
          }}
          linkDirectionalParticleWidth={0.75}
          linkDirectionalParticleColor={() => PARTICLE_COLOR}
          linkDirectionalParticleSpeed={0.0018}
          enableNodeDrag
          enableNavigationControls
          enablePointerInteraction
          warmupTicks={1}
          cooldownTicks={1}
          onNodeHover={(node: object | null) => setHoveredId((node as LensNode | null)?.id ?? null)}
          onNodeClick={handleClick}
          onNodeDragEnd={(node: object) => {
            const typed = node as LensNode3D;
            typed.baseX = typed.x;
            typed.baseY = typed.y;
            typed.baseZ = typed.z;
          }}
          onBackgroundClick={() => onSelect(null)}
        />
      )}
    </div>
  );
}
