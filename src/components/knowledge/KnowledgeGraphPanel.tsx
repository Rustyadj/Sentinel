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

interface GraphNode {
  id: string;
  label: string;
  type: string;
  val: number;
  x?: number;
  y?: number;
  [key: string]: unknown;
}

interface KnowledgeGraphPanelProps {
  roomId?: string;
  projectId?: string;
  isStreaming?: boolean;
  refreshKey?: number;
  onClose: () => void;
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
}: KnowledgeGraphPanelProps) {
  const [graphData, setGraphData] = useState<GraphData>({ nodes: [], edges: [] });
  const [selectedNode, setSelectedNode] = useState<KnowledgeNode | null>(null);
  const [search, setSearch] = useState("");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [width, setWidth] = useState(320);
  const [height, setHeight] = useState(400);
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(undefined);
  const wasStreamingRef = useRef(false);
  const pollIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

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
      filteredNodes.map((n) => ({
        ...n,
        id: n.id,
        label: n.title,
        type: n.type,
        val: n.type === "Agent" && isStreaming ? 8 : 4,
      })),
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

  // Custom node canvas drawing
  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as GraphNode;
      const radius = (n.val ?? 4);
      const color = NODE_COLORS[n.type] ?? NODE_COLORS.default;
      const x = n.x ?? 0;
      const y = n.y ?? 0;

      // Glow for active agent during streaming
      if (isStreaming && n.type === "Agent") {
        ctx.beginPath();
        ctx.arc(x, y, radius + 4, 0, 2 * Math.PI);
        ctx.fillStyle = color + "33";
        ctx.fill();
      }

      // Main circle
      ctx.beginPath();
      ctx.arc(x, y, radius, 0, 2 * Math.PI);
      ctx.fillStyle = color;
      ctx.fill();

      // Label (only show if zoomed in)
      if (globalScale > 1.5) {
        const label = n.label.length > 12 ? n.label.slice(0, 12) + "…" : n.label;
        ctx.font = `${10 / globalScale}px sans-serif`;
        ctx.fillStyle = "#e8eaed";
        ctx.textAlign = "center";
        ctx.fillText(label, x, y + radius + 8 / globalScale);
      }
    },
    [isStreaming]
  );

  const handleNodeClick = useCallback(
    (node: object) => {
      const n = node as GraphNode;
      const knowledgeNode = graphData.nodes.find((kn) => kn.id === n.id) ?? null;
      setSelectedNode(knowledgeNode);
    },
    [graphData.nodes]
  );

  return (
    <div className="flex flex-col h-full bg-[--card] border-l border-[--border]">
      {/* Header */}
      <div className="h-10 border-b border-[--border] px-3 flex items-center gap-2 shrink-0">
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
      <div className="border-b border-[--border] px-3 py-2 shrink-0">
        <KnowledgeGraphFilters
          search={search}
          onSearchChange={setSearch}
          activeTypes={activeTypes}
          onToggleType={handleToggleType}
          nodeTypes={nodeTypes}
        />
      </div>

      {/* Graph canvas (relative for drawer overlay) */}
      <div ref={containerRef} className="flex-1 relative overflow-hidden">
        <ForceGraph2D
          ref={fgRef}
          graphData={fgData}
          backgroundColor="#0c0d0f"
          nodeLabel="label"
          nodeColor={(n) => NODE_COLORS[(n as GraphNode).type] ?? NODE_COLORS.default}
          nodeVal={(n) => (n as GraphNode).val ?? 4}
          nodeCanvasObject={nodeCanvasObject}
          linkColor={() => "#1e2124"}
          linkWidth={1}
          linkDirectionalArrowLength={3}
          linkDirectionalArrowRelPos={1}
          onNodeClick={handleNodeClick}
          width={width}
          height={height}
          enableZoomInteraction
          enablePanInteraction
        />
        <KnowledgeNodeDrawer
          node={selectedNode}
          onClose={() => setSelectedNode(null)}
        />
      </div>
    </div>
  );
}
