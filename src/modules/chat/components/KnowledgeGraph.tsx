"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { Network, Filter, X, Maximize2, Minimize2 } from "lucide-react";
import { cn } from "@/lib/utils";

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeKind = "project" | "agent" | "memory" | "file" | "decision" | "workflow" | "repo" | "task";

interface GraphNode {
  id: string;
  kind: NodeKind;
  label: string;
  x: number;
  y: number;
  active?: boolean;
}

interface GraphEdge {
  source: string;
  target: string;
  label?: string;
}

// ─── Config ───────────────────────────────────────────────────────────────────

const KIND_CONFIG: Record<NodeKind, { color: string; bg: string }> = {
  project:  { color: "#6366F1", bg: "#6366F122" },
  agent:    { color: "#8B5CF6", bg: "#8B5CF622" },
  memory:   { color: "#06B6D4", bg: "#06B6D422" },
  file:     { color: "#F59E0B", bg: "#F59E0B22" },
  decision: { color: "#10B981", bg: "#10B98122" },
  workflow: { color: "#EC4899", bg: "#EC489922" },
  repo:     { color: "#F97316", bg: "#F9731622" },
  task:     { color: "#84CC16", bg: "#84CC1622" },
};

// ─── Mock graph data ──────────────────────────────────────────────────────────

const INITIAL_NODES: GraphNode[] = [
  { id: "p1", kind: "project",  label: "Sentinel OS",    x: 200, y: 180, active: true  },
  { id: "p2", kind: "project",  label: "AvraxeAI",       x: 380, y: 80  },
  { id: "a1", kind: "agent",    label: "Hermes Lisa",     x: 90,  y: 80, active: true  },
  { id: "a2", kind: "agent",    label: "Hermes Clint",   x: 90,  y: 270 },
  { id: "a3", kind: "agent",    label: "OpenClaw",        x: 320, y: 290 },
  { id: "m1", kind: "memory",   label: "Auth pattern",   x: 360, y: 200 },
  { id: "m2", kind: "memory",   label: "DB schema v3",   x: 450, y: 260 },
  { id: "f1", kind: "file",     label: "AppShell.tsx",   x: 200, y: 320 },
  { id: "f2", kind: "file",     label: "schema.prisma",  x: 480, y: 160 },
  { id: "d1", kind: "decision", label: "BUSL license",   x: 160, y: 50  },
  { id: "w1", kind: "workflow", label: "Deploy pipeline", x: 320, y: 50  },
  { id: "r1", kind: "repo",     label: "Rustyadj/Sentinel", x: 430, y: 350 },
  { id: "t1", kind: "task",     label: "Phase 9 polish", x: 80,  y: 360 },
  { id: "t2", kind: "task",     label: "Invite system",  x: 510, y: 80  },
];

const INITIAL_EDGES: GraphEdge[] = [
  { source: "a1", target: "p1", label: "manages" },
  { source: "a2", target: "p1" },
  { source: "a3", target: "p2" },
  { source: "p1", target: "m1" },
  { source: "p1", target: "f1" },
  { source: "p1", target: "f2" },
  { source: "m1", target: "m2" },
  { source: "p1", target: "r1" },
  { source: "p2", target: "r1" },
  { source: "d1", target: "p1" },
  { source: "w1", target: "p1" },
  { source: "a1", target: "t1" },
  { source: "a1", target: "t2" },
  { source: "p2", target: "t2" },
  { source: "a2", target: "t1" },
];

const NODE_RADIUS = 22;

// ─── Component ───────────────────────────────────────────────────────────────

interface Props {
  className?: string;
}

export function KnowledgeGraph({ className }: Props) {
  const svgRef = useRef<SVGSVGElement>(null);
  const [nodes, setNodes] = useState<GraphNode[]>(INITIAL_NODES);
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [filters, setFilters] = useState<Set<NodeKind>>(new Set());
  const [showFilters, setShowFilters] = useState(false);
  const [expanded, setExpanded] = useState(false);

  // Slow drift animation
  useEffect(() => {
    const DRIFT = 0.15;
    let frame: number;
    const offsets = nodes.map(() => ({ dx: (Math.random() - 0.5) * DRIFT, dy: (Math.random() - 0.5) * DRIFT }));
    let tick = 0;

    function animate() {
      tick++;
      if (tick % 4 === 0) {
        setNodes((prev) =>
          prev.map((n, i) => {
            const nx = n.x + offsets[i].dx;
            const ny = n.y + offsets[i].dy;
            if (nx < 30 || nx > 550) offsets[i].dx *= -1;
            if (ny < 30 || ny > 400) offsets[i].dy *= -1;
            return { ...n, x: n.x + offsets[i].dx, y: n.y + offsets[i].dy };
          })
        );
      }
      frame = requestAnimationFrame(animate);
    }
    frame = requestAnimationFrame(animate);
    return () => cancelAnimationFrame(frame);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const visibleNodes = nodes.filter((n) => filters.size === 0 || !filters.has(n.kind));

  const nodeById = useCallback((id: string) => nodes.find((n) => n.id === id), [nodes]);

  function toggleFilter(kind: NodeKind) {
    setFilters((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) { next.delete(kind); } else { next.add(kind); }
      return next;
    });
  }

  const selectedNode = selectedId ? nodeById(selectedId) : null;

  return (
    <div className={cn("flex flex-col bg-[#080a0d] border border-[#1e2130] rounded-xl overflow-hidden", expanded && "fixed inset-4 z-50 shadow-2xl", className)}>
      {/* Header */}
      <div className="flex items-center gap-2 px-3 py-2 border-b border-[#1e2130] shrink-0">
        <Network className="w-3.5 h-3.5 text-indigo-400" />
        <span className="text-xs font-medium text-[#c8cdd8]">Knowledge Graph</span>
        <span className="text-[9px] text-[#3a3f50] ml-1">{visibleNodes.length} nodes</span>
        <div className="flex-1" />
        <button
          onClick={() => setShowFilters((p) => !p)}
          className={cn("p-1 rounded transition-colors", showFilters ? "text-indigo-400 bg-indigo-500/10" : "text-[#5a5f6e] hover:text-[#c8cdd8]")}
        >
          <Filter className="w-3 h-3" />
        </button>
        <button
          onClick={() => setExpanded((p) => !p)}
          className="p-1 rounded text-[#5a5f6e] hover:text-[#c8cdd8] transition-colors"
        >
          {expanded ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
        </button>
      </div>

      {/* Filters */}
      {showFilters && (
        <div className="flex flex-wrap gap-1 px-3 py-2 border-b border-[#1e2130] shrink-0">
          {(Object.keys(KIND_CONFIG) as NodeKind[]).map((kind) => {
            const cfg = KIND_CONFIG[kind];
            const hidden = filters.has(kind);
            return (
              <button
                key={kind}
                onClick={() => toggleFilter(kind)}
                className={cn(
                  "flex items-center gap-1 px-2 py-0.5 rounded-full text-[9px] font-medium border transition-colors",
                  hidden
                    ? "border-[#1e2130] text-[#3a3f50] bg-transparent"
                    : "border-transparent text-white"
                )}
                style={hidden ? {} : { background: cfg.bg, color: cfg.color, borderColor: cfg.color + "44" }}
              >
                <span className="capitalize">{kind}</span>
                {!hidden && <X className="w-2 h-2" />}
              </button>
            );
          })}
        </div>
      )}

      {/* SVG canvas */}
      <div className="flex-1 relative overflow-hidden" style={{ minHeight: expanded ? undefined : 220 }}>
        <svg
          ref={svgRef}
          className="w-full h-full"
          viewBox="0 0 580 420"
          preserveAspectRatio="xMidYMid meet"
        >
          <defs>
            <marker id="arrowhead" markerWidth="6" markerHeight="6" refX="5" refY="3" orient="auto">
              <path d="M0,0 L0,6 L6,3 z" fill="#2a2f40" />
            </marker>
          </defs>

          {/* Edges */}
          {INITIAL_EDGES.map((edge, i) => {
            const src = nodeById(edge.source);
            const tgt = nodeById(edge.target);
            if (!src || !tgt) return null;
            const srcVisible = visibleNodes.some((n) => n.id === edge.source);
            const tgtVisible = visibleNodes.some((n) => n.id === edge.target);
            if (!srcVisible || !tgtVisible) return null;
            const isHighlighted = selectedId === edge.source || selectedId === edge.target;
            return (
              <line
                key={i}
                x1={src.x} y1={src.y} x2={tgt.x} y2={tgt.y}
                stroke={isHighlighted ? "#6366f1" : "#1e2130"}
                strokeWidth={isHighlighted ? 1.5 : 1}
                markerEnd="url(#arrowhead)"
                opacity={isHighlighted ? 1 : 0.6}
              />
            );
          })}

          {/* Nodes */}
          {visibleNodes.map((node) => {
            const cfg = KIND_CONFIG[node.kind];
            const isHovered = hoveredId === node.id;
            const isSelected = selectedId === node.id;
            const isActive = node.active;
            const r = isHovered || isSelected ? NODE_RADIUS + 3 : NODE_RADIUS;

            return (
              <g
                key={node.id}
                transform={`translate(${node.x}, ${node.y})`}
                className="cursor-pointer"
                onMouseEnter={() => setHoveredId(node.id)}
                onMouseLeave={() => setHoveredId(null)}
                onClick={() => setSelectedId((prev) => prev === node.id ? null : node.id)}
              >
                {isActive && (
                  <circle r={r + 6} fill="none" stroke={cfg.color} strokeWidth={1} opacity={0.25} strokeDasharray="3 3" />
                )}
                <circle
                  r={r}
                  fill={cfg.bg}
                  stroke={isSelected ? cfg.color : isHovered ? cfg.color + "88" : "#1e2130"}
                  strokeWidth={isSelected ? 2 : 1}
                />
                {/* Icon as text — SVG foreignObject not supported in all contexts so we use emoji/letter */}
                <text
                  textAnchor="middle"
                  dominantBaseline="central"
                  fontSize="11"
                  fill={cfg.color}
                  fontWeight="600"
                >
                  {node.kind === "project" ? "P" :
                   node.kind === "agent" ? "A" :
                   node.kind === "memory" ? "M" :
                   node.kind === "file" ? "F" :
                   node.kind === "decision" ? "D" :
                   node.kind === "workflow" ? "W" :
                   node.kind === "repo" ? "R" : "T"}
                </text>
                {(isHovered || isSelected) && (
                  <text
                    y={r + 12}
                    textAnchor="middle"
                    fontSize="8"
                    fill="#c8cdd8"
                    className="pointer-events-none select-none"
                  >
                    {node.label}
                  </text>
                )}
              </g>
            );
          })}
        </svg>

        {/* Selected node detail */}
        {selectedNode && (
          <div className="absolute bottom-2 left-2 right-2 bg-[#0c0e12] border border-[#1e2130] rounded-xl p-3">
            <div className="flex items-center gap-2 mb-1.5">
              <div
                className="w-5 h-5 rounded-md flex items-center justify-center shrink-0"
                style={{ background: KIND_CONFIG[selectedNode.kind].bg }}
              >
                <span className="text-[8px] font-bold" style={{ color: KIND_CONFIG[selectedNode.kind].color }}>
                  {selectedNode.kind[0].toUpperCase()}
                </span>
              </div>
              <span className="text-xs font-medium text-[#c8cdd8] truncate">{selectedNode.label}</span>
              <span className="text-[9px] text-[#5a5f6e] capitalize ml-auto">{selectedNode.kind}</span>
            </div>
            <div className="text-[9px] text-[#5a5f6e]">
              {INITIAL_EDGES.filter((e) => e.source === selectedNode.id || e.target === selectedNode.id).length} connections
              {selectedNode.active && <span className="ml-2 text-emerald-400">● active</span>}
            </div>
          </div>
        )}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-x-3 gap-y-1 px-3 py-2 border-t border-[#1e2130] shrink-0">
        {(Object.entries(KIND_CONFIG) as [NodeKind, typeof KIND_CONFIG[NodeKind]][]).map(([kind, cfg]) => (
          <div key={kind} className="flex items-center gap-1">
            <span className="w-1.5 h-1.5 rounded-full" style={{ background: cfg.color }} />
            <span className="text-[9px] text-[#5a5f6e] capitalize">{kind}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
