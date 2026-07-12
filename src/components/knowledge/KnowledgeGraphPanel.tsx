"use client";

import dynamic from "next/dynamic";
import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { KnowledgeGraphFilters } from "./KnowledgeGraphFilters";
import { KnowledgeNodeDrawer } from "./KnowledgeNodeDrawer";
import type { KnowledgeNode, KnowledgeEdge } from "@/lib/knowledge/types";

// react-force-graph-2d must be dynamically imported with ssr: false
const ForceGraph2D = dynamic(() => import("react-force-graph-2d"), {
  ssr: false,
  loading: () => (
    <div className="flex items-center justify-center h-full text-xs text-[--muted-foreground]">
      Loading graph…
    </div>
  ),
});

const NODE_COLORS: Record<string, string> = {
  Conversation: "#6366f1",
  Message: "#8b5cf6",
  Memory: "#10b981",
  Note: "#f59e0b",
  Decision: "#ef4444",
  Task: "#3b82f6",
  Agent: "#ec4899",
  Project: "#6366f1",
  Workspace: "#0891b2",
  Artifact: "#84cc16",
  File: "#64748b",
  default: "#6b7280",
};

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

interface KnowledgeGraphPanelProps {
  roomId?: string;
  projectId?: string;
  isStreaming?: boolean;
  refreshKey?: number;
  onClose: () => void;
  immersive?: boolean;
}

interface GraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
}

export function KnowledgeGraphPanel({
  roomId,
  projectId,
  isStreaming,
  refreshKey,
  onClose,
  immersive = false,
}: KnowledgeGraphPanelProps) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(() => immersive
    ? new Set(["Conversation", "Message", "Memory", "Note", "Decision", "File"])
    : new Set()
  );
  const [activeLens, setActiveLens] = useState<"Knowledge" | "Execution" | "People">("Knowledge");
  const [width, setWidth] = useState(320);
  const [height, setHeight] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(undefined);
  const wasStreamingRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const driftIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchGraph = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (roomId) params.set("roomId", roomId);
      if (projectId) params.set("projectId", projectId);
      const res = await fetch(`/api/graph?${params.toString()}`);
      if (res.ok) {
        const data = await res.json() as GraphData;
        setGraphData(data);
      }
    } catch {
      // silently ignore fetch errors
    }
  }, [roomId, projectId]);

  // Fetch on mount and when roomId/projectId changes
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void fetchGraph();
  }, [fetchGraph]);

  // Refetch after streaming completes
  useEffect(() => {
    if (wasStreamingRef.current && !isStreaming) {
      wasStreamingRef.current = false;
      const timeout = setTimeout(() => void fetchGraph(), 500);
      return () => clearTimeout(timeout);
    }
    wasStreamingRef.current = !!isStreaming;
  }, [isStreaming, fetchGraph]);

  // Refetch immediately when a knowledge_update SSE event arrives
  useEffect(() => {
    if (refreshKey !== undefined && refreshKey > 0) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      void fetchGraph();
    }
  }, [refreshKey, fetchGraph]);

  // Poll every 5 seconds
  useEffect(() => {
    pollIntervalRef.current = setInterval(() => void fetchGraph(), 5000);
    return () => {
      if (pollIntervalRef.current) clearInterval(pollIntervalRef.current);
    };
  }, [fetchGraph]);

  // ResizeObserver for container dimensions
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWidth(entry.contentRect.width);
        setHeight(entry.contentRect.height);
      }
    });
    observer.observe(el);
    // Set initial size
    setWidth(el.offsetWidth);
    setHeight(el.offsetHeight);
    return () => observer.disconnect();
  }, []);

  // Node types present in graph
  const nodeTypes = useMemo(() => {
    const types = new Set(graphData.nodes.map((n) => n.type));
    return Array.from(types).sort();
  }, [graphData.nodes]);

  const handleToggleType = useCallback((type: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleLensChange = useCallback((lens: "Knowledge" | "Execution" | "People") => {
    setActiveLens(lens);
    const lensTypes: Record<typeof lens, string[]> = {
      Knowledge: ["Conversation", "Message", "Memory", "Note", "Decision", "File"],
      Execution: ["Agent", "Task", "Artifact", "Project"],
      People: ["Agent", "Workspace", "Project"],
    };
    setActiveTypes(new Set(lensTypes[lens]));
  }, []);

  // Filter nodes
  const filteredNodes = useMemo(() => {
    return graphData.nodes.filter((n) => {
      const matchesSearch =
        search === "" || n.title.toLowerCase().includes(search.toLowerCase());
      const matchesType = activeTypes.size === 0 || activeTypes.has(n.type);
      return matchesSearch && matchesType;
    });
  }, [graphData.nodes, search, activeTypes]);

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes]
  );

  const filteredEdges = useMemo(() => {
    return graphData.edges.filter(
      (e) => filteredNodeIds.has(e.fromObjectId) && filteredNodeIds.has(e.toObjectId)
    );
  }, [graphData.edges, filteredNodeIds]);

  // Map to ForceGraph2D format
  const fgNodes: GraphNode[] = useMemo(
    () =>
      filteredNodes.map((n) => {
        const [anchorX, anchorY] = CLUSTER_ANCHORS[n.type] ?? [0, 0];
        const seed = hashNodeId(n.id);
        const angle = seed * Math.PI * 2;
        const spread = 24 + hashNodeId(`${n.id}:spread`) * 62;
        return {
          ...n,
          id: n.id,
          label: n.title,
          type: n.type,
          val: n.type === "Project" ? 9 : n.type === "Agent" && isStreaming ? 8 : n.type === "Agent" ? 6 : 4,
          x: anchorX + Math.cos(angle) * spread,
          y: anchorY + Math.sin(angle) * spread,
        };
      }),
    [filteredNodes, isStreaming]
  );

  const fgLinks = useMemo(
    () =>
      filteredEdges.map((e) => ({
        source: e.fromObjectId,
        target: e.toObjectId,
        type: e.type,
      })),
    [filteredEdges]
  );

  const fgData = useMemo(
    () => ({ nodes: fgNodes, links: fgLinks }),
    [fgNodes, fgLinks]
  );

  useEffect(() => {
    if (!immersive || typeof window === "undefined") return;
    const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");
    driftIntervalRef.current = setInterval(() => {
      if (motionQuery.matches || document.visibilityState !== "visible") return;
      const phase = Date.now() * 0.00018;
      fgNodes.forEach((node, index) => {
        if (node.fx != null || node.fy != null || node.x == null || node.y == null) return;
        const seed = hashNodeId(node.id);
        node.x += Math.sin(phase + seed * 6.28) * (0.34 + (index % 3) * 0.05);
        node.y += Math.cos(phase * 0.83 + seed * 4.1) * (0.3 + (index % 4) * 0.04);
      });
      fgRef.current?.d3ReheatSimulation?.();
    }, 3200);
    return () => {
      if (driftIntervalRef.current) clearInterval(driftIntervalRef.current);
    };
  }, [fgNodes, immersive]);

  // Custom node canvas drawing
  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode;
      const radius = n.val ?? 4;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      drawKnowledgeNode(n, ctx, globalScale, {
        active: !!isStreaming && n.type === "Agent",
        selected: selectedNode?.id === n.id,
        hovered: hoveredNodeId === n.id,
      });

      // Label (only show if zoomed in)
      if (globalScale > 1.5) {
        const label = n.label.length > 12 ? n.label.slice(0, 12) + "…" : n.label;
        ctx.font = `${10 / globalScale}px sans-serif`;
        ctx.fillStyle = "#e8eaed";
        ctx.textAlign = "center";
        ctx.fillText(label, x, y + radius + 8 / globalScale);
      }
    },
    [hoveredNodeId, isStreaming, selectedNode?.id]
  );

  const handleNodeClick = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      const knowledgeNode = graphData.nodes.find((kn) => kn.id === n.id) ?? null;
      setSelectedNode(knowledgeNode);
      if (n.x != null && n.y != null) {
        fgRef.current?.centerAt?.(n.x, n.y, 650);
        fgRef.current?.zoom?.(2.1, 650);
      }
    },
    [graphData.nodes]
  );

  return (
    <div className={immersive ? "neural-space relative flex h-full flex-col overflow-hidden bg-[#020711]" : "flex flex-col h-full bg-[--card] border-l border-[--border]"}>
      {/* Header */}
      <div className={immersive ? "absolute left-4 right-4 top-4 z-20 flex h-10 items-center gap-2 rounded-lg border border-white/10 bg-[#07101c]/78 px-3 shadow-2xl backdrop-blur-xl" : "h-10 border-b border-[--border] px-3 flex items-center gap-2 shrink-0"}>
        <span className="text-xs font-medium text-[--foreground]">Knowledge Graph</span>
        <span className="text-[10px] text-[--muted-foreground] ml-1">
          {filteredNodes.length} nodes
        </span>
        <button
          className="ml-auto text-[--muted-foreground] hover:text-[--foreground] transition-colors text-sm leading-none"
          onClick={onClose}
        >
          ✕
        </button>
      </div>

      {/* Filters */}
      <div className={immersive ? "absolute left-4 top-16 z-20 w-52 rounded-lg border border-white/10 bg-[#07101c]/82 px-3 py-3 shadow-2xl backdrop-blur-xl" : "border-b border-[--border] px-3 py-2 shrink-0"}>
        {immersive && (
          <div className="mb-3 grid grid-cols-3 gap-1 border-b border-white/8 pb-3">
            {(["Knowledge", "Execution", "People"] as const).map((lens) => (
              <button key={lens} onClick={() => handleLensChange(lens)} className={`h-7 rounded text-[9px] transition-colors ${activeLens === lens ? "bg-indigo-500/20 text-indigo-200" : "text-white/40 hover:bg-white/5 hover:text-white"}`}>
                {lens}
              </button>
            ))}
          </div>
        )}
        <KnowledgeGraphFilters
          search={search}
          onSearchChange={setSearch}
          activeTypes={activeTypes}
          onToggleType={handleToggleType}
          nodeTypes={nodeTypes}
        />
      </div>

      {/* Graph canvas (relative for drawer overlay) */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden neural-space-canvas">
        <ForceGraph2D
          ref={fgRef}
          graphData={fgData}
          backgroundColor="#020711"
          nodeLabel="label"
          nodeColor={(n) => NODE_COLORS[(n as GraphNode).type] ?? NODE_COLORS.default}
          nodeVal={(n) => (n as GraphNode).val ?? 4}
          nodeCanvasObject={nodeCanvasObject}
          linkColor={(link) => isHighlightedLink(link as { source: unknown; target: unknown }, hoveredNodeId) ? "rgba(125,211,252,.72)" : "rgba(99,130,168,.2)"}
          linkWidth={(link) => isHighlightedLink(link as { source: unknown; target: unknown }, hoveredNodeId) ? 1.8 : 0.7}
          linkCurvature={0.08}
          linkDirectionalParticles={immersive ? 2 : 1}
          linkDirectionalParticleWidth={(link) => isHighlightedLink(link as { source: unknown; target: unknown }, hoveredNodeId) ? 2.8 : 1.3}
          linkDirectionalParticleSpeed={0.0028}
          linkDirectionalParticleColor={() => "#7dd3fc"}
          onNodeClick={handleNodeClick}
          onNodeHover={(node) => setHoveredNodeId((node as GraphNode | null)?.id ?? null)}
          onNodeDragEnd={(node) => {
            const n = node as GraphNode;
            n.fx = n.x;
            n.fy = n.y;
          }}
          warmupTicks={40}
          cooldownTicks={160}
          d3AlphaDecay={0.035}
          d3VelocityDecay={0.38}
          autoPauseRedraw={false}
          width={width}
          height={height}
          enableZoomInteraction
          enablePanInteraction
        />
        <KnowledgeNodeDrawer
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
          immersive={immersive}
        />
      </div>
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

function endpointId(endpoint: unknown): string | null {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object" && "id" in endpoint) {
    return String((endpoint as { id: unknown }).id);
  }
  return null;
}

function isHighlightedLink(link: { source: unknown; target: unknown }, hoveredNodeId: string | null) {
  return hoveredNodeId !== null && (endpointId(link.source) === hoveredNodeId || endpointId(link.target) === hoveredNodeId);
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, width: number, height: number, radius: number) {
  const r = Math.min(radius, width / 2, height / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + width - r, y);
  ctx.quadraticCurveTo(x + width, y, x + width, y + r);
  ctx.lineTo(x + width, y + height - r);
  ctx.quadraticCurveTo(x + width, y + height, x + width - r, y + height);
  ctx.lineTo(x + r, y + height);
  ctx.quadraticCurveTo(x, y + height, x, y + height - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function drawKnowledgeNode(
  node: GraphNode,
  ctx: CanvasRenderingContext2D,
  globalScale: number,
  state: { active: boolean; selected: boolean; hovered: boolean }
) {
  const x = node.x ?? 0;
  const y = node.y ?? 0;
  const color = NODE_COLORS[node.type] ?? NODE_COLORS.default;
  const base = node.val ?? 4;
  const emphasis = state.selected ? 1.22 : state.hovered ? 1.12 : 1;
  const pulse = state.active ? 1 + Math.sin(Date.now() * 0.004) * 0.12 : 1;
  const radius = base * emphasis * pulse;

  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = state.active || state.selected ? 18 / globalScale : 7 / globalScale;
  ctx.lineWidth = (state.selected ? 1.8 : 0.9) / globalScale;
  ctx.strokeStyle = color;

  if (node.type === "Project" || node.type === "Workspace" || node.type === "Conversation") {
    const width = 46 / globalScale;
    const height = 24 / globalScale;
    roundedRectPath(ctx, x - width / 2, y - height / 2, width, height, 5 / globalScale);
    ctx.fillStyle = "rgba(7,16,28,.94)";
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = color;
    ctx.fillRect(x - width / 2, y - height / 2, 2 / globalScale, height);
  } else if (node.type === "Agent") {
    ctx.globalAlpha = 0.36;
    ctx.beginPath();
    ctx.arc(x, y, radius + 4 / globalScale, 0, Math.PI * 2);
    ctx.stroke();
    ctx.globalAlpha = 1;
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = "#071522";
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(x, y, Math.max(1.6, radius * 0.34), 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
  } else if (node.type === "Decision") {
    ctx.beginPath();
    ctx.moveTo(x, y - radius);
    ctx.lineTo(x + radius, y);
    ctx.lineTo(x, y + radius);
    ctx.lineTo(x - radius, y);
    ctx.closePath();
    ctx.fillStyle = `${color}33`;
    ctx.fill();
    ctx.stroke();
  } else if (node.type === "File" || node.type === "Note" || node.type === "Artifact") {
    const width = radius * 1.55;
    const height = radius * 1.95;
    roundedRectPath(ctx, x - width / 2, y - height / 2, width, height, 1.5 / globalScale);
    ctx.fillStyle = "#0a1520";
    ctx.fill();
    ctx.stroke();
    ctx.beginPath();
    ctx.moveTo(x - width * 0.25, y - height * 0.12);
    ctx.lineTo(x + width * 0.25, y - height * 0.12);
    ctx.moveTo(x - width * 0.25, y + height * 0.14);
    ctx.lineTo(x + width * 0.18, y + height * 0.14);
    ctx.stroke();
  } else if (node.type === "Task") {
    roundedRectPath(ctx, x - radius * 1.45, y - radius * 0.62, radius * 2.9, radius * 1.24, radius * 0.62);
    ctx.fillStyle = `${color}26`;
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = node.type === "Memory" ? `${color}55` : `${color}cc`;
    ctx.fill();
    ctx.stroke();
    if (node.type === "Memory") {
      ctx.beginPath();
      ctx.arc(x, y, Math.max(1, radius * 0.3), 0, Math.PI * 2);
      ctx.fillStyle = "#ffffff";
      ctx.fill();
    }
  }
  ctx.restore();
}
