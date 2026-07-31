"use client";

import dynamic from "next/dynamic";
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { Maximize2, X } from "lucide-react";
import { KnowledgeGraphFilters } from "@/components/knowledge/KnowledgeGraphFilters";
import { KnowledgeNodeDrawer } from "@/components/knowledge/KnowledgeNodeDrawer";
import { knowledgeNodeColor } from "@/lib/knowledge/colors";
import type {
  GraphData as KnowledgeGraphData,
  KnowledgeNode,
} from "@/lib/knowledge/types";
import { cn } from "@/lib/utils";

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

const CLUSTER_ANCHORS: Record<string, readonly [number, number]> = {
  Project: [0, 0],
  Conversation: [0, 35],
  Workspace: [0, -35],
  Agent: [170, 80],
  Task: [-165, 85],
  Decision: [-185, -55],
  Memory: [155, -90],
  Note: [80, -150],
  File: [120, -135],
  Artifact: [-95, -145],
  Message: [0, 120],
};

const LENS_TYPES = {
  Knowledge: ["Conversation", "Message", "Memory", "Note", "Decision", "File"],
  Execution: ["Agent", "Task", "Artifact", "Project"],
  People: ["Agent", "Workspace", "Project"],
} as const;

type GraphView = "universe" | "context" | "cluster";
type GraphLens = keyof typeof LENS_TYPES;

interface GraphNode {
  id: string;
  label: string;
  type: string;
  val: number;
  x?: number;
  y?: number;
  fx?: number;
  fy?: number;
  [key: string]: unknown;
}

interface GraphLink {
  source: string | GraphNode;
  target: string | GraphNode;
  type: string;
}

export interface GraphCanvasProps {
  /** Universe is unscoped; context is chat-scoped; cluster is source-root scoped. */
  view?: GraphView;
  roomId?: string;
  projectId?: string;
  /** Source-backed root for a one-hop Cluster Mode neighborhood. */
  sourceType?: string;
  sourceId?: string;
  isStreaming?: boolean;
  /** Bump after an SSE knowledge_update or another graph-writing action. */
  refreshKey?: number;
  immersive?: boolean;
  onClose?: () => void;
  title?: string;
  className?: string;
}

function subscribeReducedMotion(callback: () => void) {
  const query = window.matchMedia(REDUCED_MOTION_QUERY);
  query.addEventListener("change", callback);
  return () => query.removeEventListener("change", callback);
}

function getReducedMotion() {
  return window.matchMedia(REDUCED_MOTION_QUERY).matches;
}

export function GraphCanvas({
  view = "universe",
  roomId,
  projectId,
  sourceType,
  sourceId,
  isStreaming = false,
  refreshKey,
  immersive = false,
  onClose,
  title = "Knowledge Graph",
  className,
}: GraphCanvasProps) {
  const [graphData, setGraphData] = useState<KnowledgeGraphData>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(() =>
    view === "context" && immersive ? new Set(LENS_TYPES.Knowledge) : new Set()
  );
  const [activeLens, setActiveLens] = useState<GraphLens>("Knowledge");
  const [size, setSize] = useState({ width: 480, height: 480 });
  const [pinnedPositions, setPinnedPositions] = useState<Map<string, { x: number; y: number }>>(
    () => new Map()
  );
  const reducedMotion = useSyncExternalStore(
    subscribeReducedMotion,
    getReducedMotion,
    () => false
  );

  const containerRef = useRef<HTMLDivElement>(null);
  // react-force-graph-2d's dynamically imported generic ref is not preserved by next/dynamic.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const forceGraphRef = useRef<any>(undefined);
  const knownIdsRef = useRef<Set<string> | null>(null);
  const addedAtRef = useRef<Map<string, number>>(new Map());
  const fittedRef = useRef(false);
  const wasStreamingRef = useRef(false);

  const graphUrl = useMemo(() => {
    if (view === "universe") return "/api/graph";
    const params = new URLSearchParams();
    if (roomId) params.set("roomId", roomId);
    if (projectId) params.set("projectId", projectId);
    if (sourceType && sourceId) {
      params.set("sourceType", sourceType);
      params.set("sourceId", sourceId);
    }
    const query = params.toString();
    return query ? `/api/graph?${query}` : "/api/graph";
  }, [projectId, roomId, sourceId, sourceType, view]);

  const fetchGraph = useCallback(async () => {
    try {
      const response = await fetch(graphUrl);
      if (!response.ok) return;
      const data = (await response.json()) as KnowledgeGraphData;
      const nextIds = new Set(data.nodes.map((node) => node.id));

      if (knownIdsRef.current === null) {
        knownIdsRef.current = nextIds;
      } else {
        const now = performance.now();
        for (const node of data.nodes) {
          if (!knownIdsRef.current.has(node.id)) addedAtRef.current.set(node.id, now);
        }
        for (const nodeId of addedAtRef.current.keys()) {
          if (!nextIds.has(nodeId)) addedAtRef.current.delete(nodeId);
        }
        knownIdsRef.current = nextIds;
      }

      setGraphData(data);
    } catch {
      // Keep the last successful graph on transient fetch failures.
    }
  }, [graphUrl]);

  useEffect(() => {
    knownIdsRef.current = null;
    addedAtRef.current.clear();
    fittedRef.current = false;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchGraph();
  }, [fetchGraph]);

  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchGraph();
    }
  }, [fetchGraph, refreshKey]);

  useEffect(() => {
    if (view === "universe") return;
    if (wasStreamingRef.current && !isStreaming) {
      wasStreamingRef.current = false;
      const timeout = setTimeout(() => void fetchGraph(), 500);
      return () => clearTimeout(timeout);
    }
    wasStreamingRef.current = isStreaming;
  }, [fetchGraph, isStreaming, view]);

  useEffect(() => {
    const pollInterval = view === "universe" ? 8000 : 5000;
    const interval = setInterval(() => void fetchGraph(), pollInterval);
    return () => clearInterval(interval);
  }, [fetchGraph, view]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setSize({ width: entry.contentRect.width, height: entry.contentRect.height });
      }
    });
    observer.observe(element);
    setSize({ width: element.offsetWidth, height: element.offsetHeight });
    return () => observer.disconnect();
  }, []);

  const nodeTypes = useMemo(
    () => Array.from(new Set(graphData.nodes.map((node) => node.type))).sort(),
    [graphData.nodes]
  );

  const handleToggleType = useCallback((type: string) => {
    setActiveTypes((current) => {
      const next = new Set(current);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleLensChange = useCallback((lens: GraphLens) => {
    setActiveLens(lens);
    setActiveTypes(new Set(LENS_TYPES[lens]));
  }, []);

  const filteredNodes = useMemo(() => {
    if (view === "universe") return graphData.nodes;
    const normalizedSearch = search.trim().toLowerCase();
    return graphData.nodes.filter((node) => {
      const matchesSearch =
        normalizedSearch === "" || node.title.toLowerCase().includes(normalizedSearch);
      const matchesType = activeTypes.size === 0 || activeTypes.has(node.type);
      return matchesSearch && matchesType;
    });
  }, [activeTypes, graphData.nodes, search, view]);

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((node) => node.id)),
    [filteredNodes]
  );

  const filteredEdges = useMemo(
    () =>
      graphData.edges.filter(
        (edge) =>
          filteredNodeIds.has(edge.fromObjectId) && filteredNodeIds.has(edge.toObjectId)
      ),
    [filteredNodeIds, graphData.edges]
  );

  const neighborIds = useMemo(() => {
    if (!hoveredNodeId) return null;
    const ids = new Set<string>([hoveredNodeId]);
    for (const edge of filteredEdges) {
      if (edge.fromObjectId === hoveredNodeId) ids.add(edge.toObjectId);
      if (edge.toObjectId === hoveredNodeId) ids.add(edge.fromObjectId);
    }
    return ids;
  }, [filteredEdges, hoveredNodeId]);

  const graphNodes = useMemo<GraphNode[]>(
    () =>
      filteredNodes.map((node) => {
        const [anchorX, anchorY] = CLUSTER_ANCHORS[node.type] ?? [0, 0];
        const seed = hashNodeId(node.id);
        const angle = seed * Math.PI * 2;
        const spread = 24 + hashNodeId(`${node.id}:spread`) * 62;
        const pinned = pinnedPositions.get(node.id);
        return {
          ...node,
          id: node.id,
          label: node.title,
          type: node.type,
          val:
            node.type === "Project"
              ? 9
              : node.type === "Agent" && isStreaming
                ? 8
                : node.type === "Agent"
                  ? 6
                  : 4,
          x: pinned?.x ?? anchorX + Math.cos(angle) * spread,
          y: pinned?.y ?? anchorY + Math.sin(angle) * spread,
          ...(pinned ? { fx: pinned.x, fy: pinned.y } : {}),
        };
      }),
    [filteredNodes, isStreaming, pinnedPositions]
  );

  const graphLinks = useMemo<GraphLink[]>(
    () =>
      filteredEdges.map((edge) => ({
        source: edge.fromObjectId,
        target: edge.toObjectId,
        type: edge.type,
      })),
    [filteredEdges]
  );

  const forceGraphData = useMemo(
    () => ({ nodes: graphNodes, links: graphLinks }),
    [graphLinks, graphNodes]
  );

  useEffect(() => {
    if (view !== "context" || !immersive || reducedMotion) return;
    const interval = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      const phase = Date.now() * 0.00018;
      graphNodes.forEach((node, index) => {
        if (node.fx != null || node.fy != null || node.x == null || node.y == null) return;
        const seed = hashNodeId(node.id);
        node.x += Math.sin(phase + seed * 6.28) * (0.34 + (index % 3) * 0.05);
        node.y += Math.cos(phase * 0.83 + seed * 4.1) * (0.3 + (index % 4) * 0.04);
      });
      forceGraphRef.current?.d3ReheatSimulation?.();
    }, 3200);
    return () => clearInterval(interval);
  }, [graphNodes, immersive, reducedMotion, view]);

  const nodeCanvasObject = useCallback(
    (node: object, context: CanvasRenderingContext2D, globalScale: number) => {
      const graphNode = node as GraphNode;
      const x = graphNode.x ?? 0;
      const y = graphNode.y ?? 0;
      const color = knowledgeNodeColor(graphNode.type);
      const dimmed = neighborIds !== null && !neighborIds.has(graphNode.id);
      const radius = graphNode.val ?? 4;

      const addedAt = addedAtRef.current.get(graphNode.id);
      if (addedAt !== undefined && !reducedMotion && !dimmed) {
        const age = performance.now() - addedAt;
        if (age < PULSE_MS) {
          const phase = (age % 1200) / 1200;
          context.beginPath();
          context.arc(x, y, radius + 3 + phase * 8, 0, Math.PI * 2);
          context.fillStyle =
            color +
            Math.round((1 - phase) * 48)
              .toString(16)
              .padStart(2, "0");
          context.fill();
        } else {
          addedAtRef.current.delete(graphNode.id);
        }
      }

      context.save();
      context.globalAlpha = dimmed ? 0.12 : 1;
      drawKnowledgeNode(graphNode, context, globalScale, {
        active: isStreaming && graphNode.type === "Agent" && !reducedMotion,
        selected: selectedNode?.id === graphNode.id,
        hovered: hoveredNodeId === graphNode.id,
      });
      context.restore();

      const showLabel =
        !dimmed && (globalScale > 1.5 || neighborIds?.has(graphNode.id));
      if (showLabel) {
        const label =
          graphNode.label.length > 18
            ? `${graphNode.label.slice(0, 18)}…`
            : graphNode.label;
        context.font = `${Math.max(10 / globalScale, 2.5)}px ui-monospace, monospace`;
        context.fillStyle = "rgba(232, 234, 237, 0.78)";
        context.textAlign = "center";
        context.fillText(label, x, y + radius + 10 / globalScale);
      }
    },
    [hoveredNodeId, isStreaming, neighborIds, reducedMotion, selectedNode?.id]
  );

  const zoomToFit = useCallback(() => {
    forceGraphRef.current?.zoomToFit?.(400, 48);
  }, []);

  const handleEngineStop = useCallback(() => {
    if (view === "universe" && !fittedRef.current && graphNodes.length > 0) {
      fittedRef.current = true;
      zoomToFit();
    }
  }, [graphNodes.length, view, zoomToFit]);

  const handleNodeClick = useCallback(
    (node: object) => {
      const graphNode = node as GraphNode;
      setSelectedNode(
        graphData.nodes.find((knowledgeNode) => knowledgeNode.id === graphNode.id) ?? null
      );
      if (view !== "universe" && graphNode.x != null && graphNode.y != null) {
        forceGraphRef.current?.centerAt?.(graphNode.x, graphNode.y, 650);
        forceGraphRef.current?.zoom?.(2.1, 650);
      }
    },
    [graphData.nodes, view]
  );

  const handleNodeDragEnd = useCallback((node: object) => {
    const graphNode = node as GraphNode;
    const { x, y } = graphNode;
    if (x == null || y == null) return;
    graphNode.fx = x;
    graphNode.fy = y;
    setPinnedPositions((current) => {
      const next = new Map(current);
      next.set(graphNode.id, { x, y });
      return next;
    });
  }, []);

  const empty = graphData.nodes.length === 0;
  const particleCount = reducedMotion
    ? 0
    : view === "universe"
      ? isStreaming
        ? 2
        : 0
      : immersive
        ? 2
        : 1;

  return (
    <div
      data-graph-canvas
      data-graph-view={view}
      className={cn(
        view !== "universe"
          ? view === "context" && immersive
            ? "neural-space relative flex h-full flex-col overflow-hidden bg-[#020711]"
            : view === "cluster"
              ? "flex h-full flex-col border-l border-[--border] bg-[#101215]"
              : "flex h-full flex-col border-l border-[--border] bg-[--card]"
          : "relative h-full w-full overflow-hidden bg-[#0a0b0d]",
        className
      )}
    >
      {view === "universe" ? (
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "radial-gradient(ellipse 60% 50% at 50% 40%, rgba(99,102,241,0.06), transparent 70%)",
          }}
        />
      ) : (
        <>
          <div
            className={
              immersive
                ? "absolute left-4 right-4 top-4 z-20 flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-[#07101c]/78 px-3 shadow-2xl backdrop-blur-xl"
                : "flex h-10 shrink-0 items-center gap-2 border-b border-[--border] px-3"
            }
          >
            <span className="truncate text-xs font-medium text-[--foreground]">{title}</span>
            <span className="ml-1 text-[10px] text-[--muted-foreground]">
              {filteredNodes.length} nodes
            </span>
            {onClose ? (
              <button
                type="button"
                aria-label="Close knowledge graph"
                className="ml-auto text-sm leading-none text-[--muted-foreground] transition-colors hover:text-[--foreground]"
                onClick={onClose}
              >
                ✕
              </button>
            ) : null}
          </div>

          <div
            className={
              immersive
                ? "absolute left-4 top-16 z-20 w-52 rounded-lg border border-white/10 bg-[#07101c]/82 px-3 py-3 shadow-2xl backdrop-blur-xl"
                : "shrink-0 border-b border-[--border] px-3 py-2"
            }
          >
            {immersive ? (
              <div className="mb-3 grid grid-cols-3 gap-1 border-b border-white/8 pb-3">
                {(Object.keys(LENS_TYPES) as GraphLens[]).map((lens) => (
                  <button
                    key={lens}
                    type="button"
                    onClick={() => handleLensChange(lens)}
                    className={cn(
                      "h-7 rounded text-[9px] transition-colors",
                      activeLens === lens
                        ? "bg-indigo-500/20 text-indigo-200"
                        : "text-white/40 hover:bg-white/5 hover:text-white"
                    )}
                  >
                    {lens}
                  </button>
                ))}
              </div>
            ) : null}
            <KnowledgeGraphFilters
              search={search}
              onSearchChange={setSearch}
              activeTypes={activeTypes}
              onToggleType={handleToggleType}
              nodeTypes={nodeTypes}
            />
          </div>
        </>
      )}

      <div
        ref={containerRef}
        className={cn(
          "overflow-hidden neural-space-canvas",
          view === "universe" ? "absolute inset-0" : "relative flex-1"
        )}
      >
        {view !== "universe" || !empty ? (
          <ForceGraph2D
            ref={forceGraphRef}
            graphData={forceGraphData}
            backgroundColor={
              view === "universe"
                ? "rgba(0,0,0,0)"
                : view === "cluster"
                  ? "#101215"
                  : "#020711"
            }
            width={size.width}
            height={size.height}
            nodeLabel={view !== "universe" ? "label" : ""}
            nodeColor={(node) => knowledgeNodeColor((node as GraphNode).type)}
            nodeVal={(node) => (node as GraphNode).val ?? 4}
            nodeCanvasObject={nodeCanvasObject}
            linkColor={(link) =>
              isHighlightedLink(link as GraphLink, hoveredNodeId)
                ? "rgba(125,211,252,.72)"
                : "rgba(99,130,168,.2)"
            }
            linkWidth={(link) =>
              isHighlightedLink(link as GraphLink, hoveredNodeId) ? 1.8 : 0.7
            }
            linkCurvature={view !== "universe" ? 0.08 : 0}
            linkDirectionalParticles={particleCount}
            linkDirectionalParticleWidth={(link) =>
              isHighlightedLink(link as GraphLink, hoveredNodeId) ? 2.8 : 1.3
            }
            linkDirectionalParticleSpeed={view === "universe" ? 0.0045 : 0.0028}
            linkDirectionalParticleColor={() =>
              view === "universe" ? "#818cf8" : "#7dd3fc"
            }
            onNodeClick={handleNodeClick}
            onNodeHover={(node) => setHoveredNodeId((node as GraphNode | null)?.id ?? null)}
            onNodeDragEnd={view !== "universe" ? handleNodeDragEnd : undefined}
            onBackgroundClick={() => setSelectedNode(null)}
            onEngineStop={handleEngineStop}
            warmupTicks={view !== "universe" ? 40 : 0}
            cooldownTicks={view !== "universe" ? 160 : 120}
            d3AlphaDecay={view !== "universe" ? 0.035 : undefined}
            d3VelocityDecay={view !== "universe" ? 0.38 : undefined}
            autoPauseRedraw={view === "universe"}
            enableZoomInteraction
            enablePanInteraction
          />
        ) : null}

        {view !== "universe" ? (
          <KnowledgeNodeDrawer
            node={selectedNode}
            onClose={() => setSelectedNode(null)}
            immersive={immersive}
          />
        ) : null}
      </div>

      {view === "universe" ? (
        <>
          <div className="pointer-events-none absolute left-4 top-4 flex items-center gap-2.5">
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                isStreaming ? "animate-pulse-dot bg-indigo-400" : "bg-emerald-400"
              )}
            />
            <span className="font-mono text-[10px] uppercase tracking-[0.18em] text-[--muted-foreground]">
              Knowledge graph
            </span>
            <span className="font-mono text-[10px] tracking-wider text-[--muted-foreground] opacity-60">
              {graphData.nodes.length} nodes · {graphData.edges.length} links
            </span>
          </div>

          {!empty ? (
            <button
              type="button"
              onClick={zoomToFit}
              title="Fit graph to view"
              aria-label="Fit graph to view"
              className="absolute right-4 top-4 flex h-7 w-7 items-center justify-center rounded-md border border-[--border] bg-[--card]/80 text-[--muted-foreground] backdrop-blur transition-colors hover:text-[--foreground]"
            >
              <Maximize2 className="h-3.5 w-3.5" />
            </button>
          ) : null}

          {empty ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
              <div className="flex gap-1.5">
                {[0, 1, 2].map((index) => (
                  <span
                    key={index}
                    className="h-1.5 w-1.5 rounded-full bg-indigo-400/40"
                    style={{ opacity: 0.3 + index * 0.25 }}
                  />
                ))}
              </div>
              <p className="text-sm text-[--foreground]">Your graph starts here</p>
              <p className="max-w-[220px] text-xs leading-relaxed text-[--muted-foreground]">
                Start a conversation and Sentinel maps what it learns as connected knowledge.
              </p>
            </div>
          ) : null}

          {selectedNode ? (
            <div className="animate-fade-in absolute bottom-4 left-4 right-4 max-w-sm rounded-xl border border-[--border] bg-[--card]/95 p-4 shadow-2xl backdrop-blur">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="mb-1 flex items-center gap-2">
                    <span
                      className="h-2 w-2 shrink-0 rounded-full"
                      style={{ backgroundColor: knowledgeNodeColor(selectedNode.type) }}
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
                  type="button"
                  aria-label="Close selected node"
                  onClick={() => setSelectedNode(null)}
                  className="shrink-0 text-[--muted-foreground] transition-colors hover:text-[--foreground]"
                >
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
              {selectedNode.summary ? (
                <p className="mt-2 line-clamp-3 text-xs leading-relaxed text-[--muted-foreground]">
                  {selectedNode.summary}
                </p>
              ) : null}
              <div className="mt-2 font-mono text-[10px] text-[--muted-foreground] opacity-60">
                {new Date(selectedNode.createdAt).toLocaleString()}
              </div>
            </div>
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function hashNodeId(id: string): number {
  let hash = 2166136261;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 4294967295;
}

function endpointId(endpoint: string | GraphNode): string {
  return typeof endpoint === "string" ? endpoint : endpoint.id;
}

function isHighlightedLink(link: GraphLink, hoveredNodeId: string | null) {
  return (
    hoveredNodeId !== null &&
    (endpointId(link.source) === hoveredNodeId || endpointId(link.target) === hoveredNodeId)
  );
}

function roundedRectPath(
  context: CanvasRenderingContext2D,
  x: number,
  y: number,
  width: number,
  height: number,
  radius: number
) {
  const cornerRadius = Math.min(radius, width / 2, height / 2);
  context.beginPath();
  context.moveTo(x + cornerRadius, y);
  context.lineTo(x + width - cornerRadius, y);
  context.quadraticCurveTo(x + width, y, x + width, y + cornerRadius);
  context.lineTo(x + width, y + height - cornerRadius);
  context.quadraticCurveTo(
    x + width,
    y + height,
    x + width - cornerRadius,
    y + height
  );
  context.lineTo(x + cornerRadius, y + height);
  context.quadraticCurveTo(x, y + height, x, y + height - cornerRadius);
  context.lineTo(x, y + cornerRadius);
  context.quadraticCurveTo(x, y, x + cornerRadius, y);
  context.closePath();
}

function drawKnowledgeNode(
  node: GraphNode,
  context: CanvasRenderingContext2D,
  globalScale: number,
  state: { active: boolean; selected: boolean; hovered: boolean }
) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const color = knowledgeNodeColor(node.type);
  const base = node.val ?? 4;
  const emphasis = state.selected ? 1.22 : state.hovered ? 1.12 : 1;
  const pulse = state.active ? 1 + Math.sin(Date.now() * 0.004) * 0.12 : 1;
  const radius = base * emphasis * pulse;

  context.save();
  context.shadowColor = color;
  context.shadowBlur = state.active || state.selected ? 18 / globalScale : 7 / globalScale;
  context.lineWidth = (state.selected ? 1.8 : 0.9) / globalScale;
  context.strokeStyle = color;
  const inheritedAlpha = context.globalAlpha;

  if (node.type === "Project" || node.type === "Workspace" || node.type === "Conversation") {
    const width = 46 / globalScale;
    const height = 24 / globalScale;
    roundedRectPath(
      context,
      x - width / 2,
      y - height / 2,
      width,
      height,
      5 / globalScale
    );
    context.fillStyle = "rgba(7,16,28,.94)";
    context.fill();
    context.stroke();
    context.fillStyle = color;
    context.fillRect(x - width / 2, y - height / 2, 2 / globalScale, height);
  } else if (node.type === "Agent") {
    context.globalAlpha = inheritedAlpha * 0.36;
    context.beginPath();
    context.arc(x, y, radius + 4 / globalScale, 0, Math.PI * 2);
    context.stroke();
    context.globalAlpha = inheritedAlpha;
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = "#071522";
    context.fill();
    context.stroke();
    context.beginPath();
    context.arc(x, y, Math.max(1.6, radius * 0.34), 0, Math.PI * 2);
    context.fillStyle = color;
    context.fill();
  } else if (node.type === "Decision") {
    context.beginPath();
    context.moveTo(x, y - radius);
    context.lineTo(x + radius, y);
    context.lineTo(x, y + radius);
    context.lineTo(x - radius, y);
    context.closePath();
    context.fillStyle = `${color}33`;
    context.fill();
    context.stroke();
  } else if (node.type === "File" || node.type === "Note" || node.type === "Artifact") {
    const width = radius * 1.55;
    const height = radius * 1.95;
    roundedRectPath(
      context,
      x - width / 2,
      y - height / 2,
      width,
      height,
      1.5 / globalScale
    );
    context.fillStyle = "#0a1520";
    context.fill();
    context.stroke();
    context.beginPath();
    context.moveTo(x - width * 0.25, y - height * 0.12);
    context.lineTo(x + width * 0.25, y - height * 0.12);
    context.moveTo(x - width * 0.25, y + height * 0.14);
    context.lineTo(x + width * 0.18, y + height * 0.14);
    context.stroke();
  } else if (node.type === "Task") {
    roundedRectPath(
      context,
      x - radius * 1.45,
      y - radius * 0.62,
      radius * 2.9,
      radius * 1.24,
      radius * 0.62
    );
    context.fillStyle = `${color}26`;
    context.fill();
    context.stroke();
  } else {
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = node.type === "Memory" ? `${color}55` : `${color}cc`;
    context.fill();
    context.stroke();
    if (node.type === "Memory") {
      context.beginPath();
      context.arc(x, y, Math.max(1, radius * 0.3), 0, Math.PI * 2);
      context.fillStyle = "#ffffff";
      context.fill();
    }
  }
  context.restore();
}
