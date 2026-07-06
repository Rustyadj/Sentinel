"use client";

import dynamic from "next/dynamic";
import {
  useState,
  useEffect,
  useRef,
  useCallback,
  useMemo,
  useSyncExternalStore,
} from "react";
import { Maximize2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { KnowledgeNode, KnowledgeEdge } from "@/lib/knowledge/types";
import { knowledgeNodeColor } from "@/lib/knowledge/colors";

// react-force-graph-2d must be dynamically imported with ssr: false
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center font-mono text-[10px] uppercase tracking-widest text-[--muted-foreground]">
      Loading graph…
    </div>
  ),
});

const PULSE_MS = 4000;

const REDUCED_MOTION_QUERY = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(callback: () => void) {
  const mq = window.matchMedia(REDUCED_MOTION_QUERY);
  mq.addEventListener("change", callback);
  return () => mq.removeEventListener("change", callback);
}

function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

interface FGNode {
  id: string;
  label: string;
  type: string;
  val: number;
  x?: number;
  y?: number;
  [key: string]: unknown;
}

interface GraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

interface LiveKnowledgeGraphProps {
  /** True while a chat response is streaming — edges carry particles */
  isStreaming?: boolean;
  /** Bump to force a refetch (e.g. after a stream completes) */
  refreshKey?: number;
  className?: string;
}

export function LiveKnowledgeGraph({
  isStreaming,
  refreshKey,
  className,
}: LiveKnowledgeGraphProps) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [hoverNodeId, setHoverNodeId] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 480, height: 480 });
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => false
  );

  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(undefined);
  const knownIdsRef = useRef<Set<string> | null>(null);
  const addedAtRef = useRef<Map<string, number>>(new Map());
  const fittedRef = useRef(false);

  const fetchGraph = useCallback(async () => {
    try {
      const res = await fetch("/api/graph");
      if (!res.ok) return;
      const data = (await res.json()) as GraphData;

      // Track newly arrived nodes so they can pulse in — skip the first load
      if (knownIdsRef.current === null) {
        knownIdsRef.current = new Set(data.nodes.map((n) => n.id));
      } else {
        const now = performance.now();
        for (const n of data.nodes) {
          if (!knownIdsRef.current.has(n.id)) {
            knownIdsRef.current.add(n.id);
            addedAtRef.current.set(n.id, now);
          }
        }
      }
      setGraphData(data);
    } catch {
      // keep last data on fetch errors
    }
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchGraph();
  }, [fetchGraph]);

  // Refetch when the chat finishes a stream (parent bumps refreshKey)
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (refreshKey !== undefined && refreshKey > 0) void fetchGraph();
  }, [refreshKey, fetchGraph]);

  // Background poll
  useEffect(() => {
    const interval = setInterval(() => void fetchGraph(), 8000);
    return () => clearInterval(interval);
  }, [fetchGraph]);

  // Track container size
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(el);
    setSize({ width: el.offsetWidth, height: el.offsetHeight });
    return () => observer.disconnect();
  }, []);

  // Neighborhood of the hovered node
  const neighborIds = useMemo(() => {
    if (!hoverNodeId) return null;
    const ids = new Set<string>([hoverNodeId]);
    for (const e of graphData.edges) {
      if (e.fromObjectId === hoverNodeId) ids.add(e.toObjectId);
      if (e.toObjectId === hoverNodeId) ids.add(e.fromObjectId);
    }
    return ids;
  }, [hoverNodeId, graphData.edges]);

  const fgData = useMemo(() => {
    const nodeIds = new Set(graphData.nodes.map((n) => n.id));
    return {
      nodes: graphData.nodes.map((n) => ({
        ...n,
        id: n.id,
        label: n.title,
        type: n.type,
        val: 4,
      })) as FGNode[],
      links: graphData.edges
        .filter((e) => nodeIds.has(e.fromObjectId) && nodeIds.has(e.toObjectId))
        .map((e) => ({ source: e.fromObjectId, target: e.toObjectId, type: e.type })),
    };
  }, [graphData]);

  const zoomToFit = useCallback(() => {
    fgRef.current?.zoomToFit(400, 48);
  }, []);

  // Fit once the simulation settles for the first time
  const handleEngineStop = useCallback(() => {
    if (!fittedRef.current && graphData.nodes.length > 0) {
      fittedRef.current = true;
      zoomToFit();
    }
  }, [graphData.nodes.length, zoomToFit]);

  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as FGNode;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const color = knowledgeNodeColor(n.type);
      const dimmed = neighborIds !== null && !neighborIds.has(n.id);
      const radius = neighborIds?.has(n.id) && n.id === hoverNodeId ? 5.5 : 4;

      // Pulse halo for nodes that just arrived
      const addedAt = addedAtRef.current.get(n.id);
      if (addedAt !== undefined && !reducedMotion) {
        const age = performance.now() - addedAt;
        if (age < PULSE_MS) {
          const phase = (age % 1200) / 1200;
          ctx.beginPath();
          ctx.arc(x, y, radius + 3 + phase * 8, 0, 2 * Math.PI);
          ctx.fillStyle =
            color +
            Math.round((1 - phase) * 48)
              .toString(16)
              .padStart(2, "0");
          ctx.fill();
        } else {
          addedAtRef.current.delete(n.id);
        }
      }

      // Soft glow
      if (!dimmed) {
        ctx.beginPath();
        ctx.arc(x, y, radius + 2.5, 0, 2 * Math.PI);
        ctx.fillStyle = color + "22";
        ctx.fill();
      }

      ctx.globalAlpha = dimmed ? 0.12 : 1;
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.globalAlpha = 1;

      // Labels when zoomed in, or for the hovered neighborhood
      const showLabel = !dimmed && (globalScale > 1.6 || neighborIds?.has(n.id));
      if (showLabel) {
        const label = n.label.length > 18 ? n.label.slice(0, 18) + "…" : n.label;
        ctx.font = `${Math.max(10 / globalScale, 2.5)}px ui-monospace, monospace`;
        ctx.fillStyle = "rgba(232, 234, 237, 0.75)";
        ctx.textAlign = "center";
        ctx.fillText(label, x, y + radius + 10 / globalScale);
      }
    },
    [neighborIds, hoverNodeId, reducedMotion]
  );

  const handleNodeHover = useCallback((node: object | null) => {
    setHoverNodeId(node ? (node as FGNode).id : null);
  }, []);

  const handleNodeClick = useCallback(
    (node: object) => {
      const n = node as FGNode;
      setSelectedNode(graphData.nodes.find((kn) => kn.id === n.id) ?? null);
    },
    [graphData.nodes]
  );

  const empty = graphData.nodes.length === 0;

  return (
    <div className={cn("relative h-full w-full overflow-hidden bg-[#0a0b0d]", className)}>
      {/* Faint ambient glow behind the graph */}
      <div
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(99,102,241,0.06), transparent 70%)",
        }}
      />

      <div ref={containerRef} className="absolute inset-0">
        {!empty && (
          <ForceGraph2D
            ref={fgRef}
            graphData={fgData}
            backgroundColor="rgba(0,0,0,0)"
            width={size.width}
            height={size.height}
            nodeLabel=""
            nodeVal={(n) => (n as FGNode).val}
            nodeCanvasObject={nodeCanvasObject}
            linkColor={(link) => {
              if (!neighborIds) return "rgba(99,102,241,0.16)";
              // eslint-disable-next-line @typescript-eslint/no-explicit-any
              const l = link as any;
              const src = typeof l.source === "object" ? l.source.id : l.source;
              const tgt = typeof l.target === "object" ? l.target.id : l.target;
              return neighborIds.has(src) && neighborIds.has(tgt)
                ? "rgba(129,140,248,0.55)"
                : "rgba(99,102,241,0.05)";
            }}
            linkWidth={1}
            linkDirectionalParticles={isStreaming && !reducedMotion ? 2 : 0}
            linkDirectionalParticleWidth={1.6}
            linkDirectionalParticleSpeed={0.0045}
            linkDirectionalParticleColor={() => "#818cf8"}
            onNodeHover={handleNodeHover}
            onNodeClick={handleNodeClick}
            onBackgroundClick={() => setSelectedNode(null)}
            onEngineStop={handleEngineStop}
            cooldownTicks={120}
            enableZoomInteraction
            enablePanInteraction
          />
        )}
      </div>

      {/* Status chip */}
      <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2.5">
        <span
          className={cn(
            "h-1.5 w-1.5 rounded-full",
            isStreaming ? "bg-indigo-400 animate-pulse-dot" : "bg-emerald-400"
          )}
        />
        <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[--muted-foreground]">
          Knowledge graph
        </span>
        <span className="font-mono text-[10px] tracking-wider text-[--muted-foreground] opacity-60">
          {graphData.nodes.length} nodes · {graphData.edges.length} links
        </span>
      </div>

      {/* Fit control */}
      {!empty && (
        <button
          onClick={zoomToFit}
          title="Fit graph to view"
          className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-md border border-[--border] bg-[--card]/80 text-[--muted-foreground] backdrop-blur transition-colors hover:text-[--foreground]"
        >
          <Maximize2 className="h-3.5 w-3.5" />
        </button>
      )}

      {/* Empty state */}
      {empty && (
        <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
          <div className="flex gap-1.5">
            {[0, 1, 2].map((i) => (
              <span
                key={i}
                className="h-1.5 w-1.5 rounded-full bg-indigo-400/40"
                style={{ opacity: 0.3 + i * 0.25 }}
              />
            ))}
          </div>
          <p className="text-sm text-[--foreground]">Your graph starts here</p>
          <p className="max-w-[220px] text-xs leading-relaxed text-[--muted-foreground]">
            Start a conversation and Sentinel maps what it learns as connected knowledge.
          </p>
        </div>
      )}

      {/* Selected node card */}
      {selectedNode && (
        <div className="animate-fade-in absolute bottom-4 left-4 right-4 max-w-sm rounded-xl border border-[--border] bg-[--card]/95 p-4 shadow-2xl backdrop-blur">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="mb-1 flex items-center gap-2">
                <span
                  className="h-2 w-2 shrink-0 rounded-full"
                  style={{
                    backgroundColor:
                      knowledgeNodeColor(selectedNode.type),
                  }}
                />
                <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[--muted-foreground]">
                  {selectedNode.type}
                </span>
              </div>
              <div className="truncate text-sm font-medium text-[--foreground]">
                {selectedNode.title}
              </div>
            </div>
            <button
              onClick={() => setSelectedNode(null)}
              className="shrink-0 text-[--muted-foreground] transition-colors hover:text-[--foreground]"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
          {selectedNode.summary && (
            <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[--muted-foreground]">
              {selectedNode.summary}
            </p>
          )}
          <div className="mt-2 font-mono text-[10px] text-[--muted-foreground] opacity-60">
            {new Date(selectedNode.createdAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}
