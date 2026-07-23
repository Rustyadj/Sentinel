"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Lock, Maximize2, Minus, Plus } from "lucide-react";
import { useGraphStore } from "@/store/useGraphStore";
import { cn } from "@/lib/utils";
import {
  GRAPH_COLORS,
  nodeColor,
  nodeRadius,
} from "@/lib/graph/theme";
import type { KnowledgeNode, KnowledgeEdge } from "@/lib/knowledge/types";

// WebGL graph stays client-only. Keeping it behind a dynamic boundary avoids
// pulling Three.js into the server-rendered shell.
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-[11px] text-[#697084]">
      <span className="h-1.5 w-1.5 animate-pulse-dot rounded-full bg-indigo-400" />
      Preparing knowledge graph…
    </div>
  ),
});

export interface GraphData {
  nodes: KnowledgeNode[];
  edges: KnowledgeEdge[];
  source?: "postgres";
}

export type GraphSource = "live" | "demo" | "offline";

interface FGNode {
  id: string;
  label: string;
  type: KnowledgeNode["type"];
  color: string;
  radius: number;
  degree: number;
  createdAt: Date;
  metadata: Record<string, unknown>;
  x?: number;
  y?: number;
  z?: number;
  fx?: number;
  fy?: number;
  fz?: number;
  [key: string]: unknown;
}

interface KnowledgeGraphProps {
  roomId?: string;
  projectId?: string;
  isStreaming?: boolean;
  refreshKey?: number;
  onDataChange?: (data: GraphData, source: GraphSource) => void;
}

// ---------------------------------------------------------------------------
// Demo dataset — shown until Postgres has real knowledge
// ---------------------------------------------------------------------------

type DemoTier = "root" | "hub" | "leaf" | "micro";
type DemoSpec = {
  id: string;
  title: string;
  type: KnowledgeNode["type"];
  x: number;
  y: number;
  z: number;
  color: string;
  tier: DemoTier;
  clusterId?: string;
};

const CLUSTER_SPECS: Array<{
  id: string;
  title: string;
  x: number;
  y: number;
  z: number;
  color: string;
  type: KnowledgeNode["type"];
  leaves: string[];
}> = [
  { id: "lead", title: "Lead Generation", x: -235, y: -110, z: 76, color: "#35e69a", type: "Project", leaves: ["Landing Pages", "Lead Magnets", "Contact Forms", "Email Campaigns", "CRM Integration", "Nurture Scoring"] },
  { id: "strategy", title: "Marketing Strategy", x: -62, y: -245, z: -118, color: "#d881c6", type: "Memory", leaves: ["Audience Research", "Content Strategy", "Market Intelligence", "Competitor Analysis", "Campaign Goals"] },
  { id: "projects", title: "Projects Portfolio", x: 206, y: -138, z: 132, color: "#22d3ee", type: "Project", leaves: ["Residential Projects", "Commercial Projects", "Case Studies", "Testimonials", "Delivery Roadmap"] },
  { id: "content", title: "Content Hub", x: 266, y: 80, z: -72, color: "#b78cff", type: "Workspace", leaves: ["Blog Posts", "Video Content", "White Papers", "Guides & Downloads", "News & Updates"] },
  { id: "workflows", title: "Workflows", x: 196, y: 250, z: 92, color: "#f2c86b", type: "Task", leaves: ["Lead Capture Flow", "Follow-up Campaigns", "Project Onboarding", "Approval Automation", "Reporting Sync"] },
  { id: "industry", title: "Industry Intelligence", x: 18, y: 220, z: -144, color: "#67d5ff", type: "Organization", leaves: ["ICF Benefits", "Construction Trends", "Sustainability", "Cost Analysis", "Market Forecast"] },
  { id: "digital", title: "Digital Marketing", x: -204, y: 135, z: 34, color: "#5d8dff", type: "Conversation", leaves: ["SEO Strategy", "Google Ads", "Social Media", "Email Marketing", "Local Marketing", "Analytics & Tracking"] },
];

const ROOT_SPEC: DemoSpec = { id: "sentinel", title: "Sentinel OS", type: "Organization", x: 0, y: 0, z: 0, color: "#fff6ff", tier: "root" };
const MICRO_NODE_COUNT = 120;

function seededUnit(seed: number, salt: number): number {
  const value = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return value - Math.floor(value);
}

const DEMO_SPECS: DemoSpec[] = [
  ROOT_SPEC,
  ...CLUSTER_SPECS.flatMap((cluster) => {
    const hub: DemoSpec = { id: cluster.id, title: cluster.title, type: cluster.type, x: cluster.x, y: cluster.y, z: cluster.z, color: cluster.color, tier: "hub", clusterId: cluster.id };
    const radiusX = cluster.leaves.length > 5 ? 88 : 82;
    const radiusY = cluster.leaves.length > 5 ? 82 : 74;
    const leaves = cluster.leaves.map((title, index): DemoSpec => {
      const angleJitter = Math.sin((index + 1) * 12.9898 + cluster.x * 0.013) * 0.38;
      const radialJitter = 0.78 + (Math.sin((index + 2) * 7.31 + cluster.y * 0.017) + 1) * 0.19;
      const angle = (Math.PI * 2 * index) / cluster.leaves.length - Math.PI / 2 + angleJitter;
      return {
        id: `${cluster.id}-${index}`,
        title,
        type: index % 3 === 0 ? "Artifact" : index % 3 === 1 ? "Note" : "File",
        x: cluster.x + Math.cos(angle) * radiusX * radialJitter,
        y: cluster.y + Math.sin(angle) * radiusY * radialJitter,
        z: cluster.z + Math.sin(angle * 1.73 + index * 0.91) * 68 * radialJitter,
        color: cluster.color,
        tier: "leaf",
        clusterId: cluster.id,
      };
    });
    return [hub, ...leaves];
  }),
];

const DEMO_NODES: KnowledgeNode[] = DEMO_SPECS.map((spec) => ({
  id: `demo-${spec.id}`,
  type: spec.type,
  title: spec.title,
  scope: "project",
  metadata: { demo: true, accent: spec.color, tier: spec.tier, clusterId: spec.clusterId, x: spec.x + 80, y: spec.y, z: spec.z },
  createdAt: new Date(),
}));

const MICRO_SPECS = CLUSTER_SPECS.flatMap((cluster, clusterIndex) =>
  Array.from({ length: MICRO_NODE_COUNT }, (_, index) => {
    const seed = clusterIndex * 97 + index + 1;
    const isCore = index % 5 === 0;
    const radialUnit = seededUnit(seed, 1);
    const radius = isCore
      ? 18 + Math.pow(radialUnit, 1.9) * 155
      : 68 + Math.pow(radialUnit, 0.62) * 282;
    const theta = seededUnit(seed, 2) * Math.PI * 2;
    const cosPhi = seededUnit(seed, 3) * 2 - 1;
    const sinPhi = Math.sqrt(1 - cosPhi * cosPhi);
    const clusterPull = 0.16 + seededUnit(seed, 7) * 0.12;
    const outlier = index % 29 === 0 ? 62 : 0;
    const x = 80 + Math.cos(theta) * sinPhi * (radius + outlier) + cluster.x * clusterPull;
    const y = Math.sin(theta) * sinPhi * (radius + outlier) + cluster.y * clusterPull;
    const z = cosPhi * (radius + outlier) + cluster.z * clusterPull;
    const palette = ["#77e6e8", "#f29ac7", "#fff0a8", "#9da8ff", "#82d7aa", "#c6a0ff", "#8cb8d8", "#f5d8ef"];
    return {
      id: `micro-${cluster.id}-${index}`,
      clusterId: cluster.id,
      x,
      y,
      z,
      color: palette[Math.floor(seededUnit(seed, 4) * palette.length)],
      radius: 0.42 + seededUnit(seed, 5) * 1.85,
    };
  })
);

const MICRO_NODES: KnowledgeNode[] = MICRO_SPECS.map((spec, index) => ({
  id: `demo-${spec.id}`,
  type: "Note",
  title: `Context trace ${String(index + 1).padStart(3, "0")}`,
  scope: "project",
  metadata: {
    demo: true,
    atmospheric: true,
    accent: spec.color,
    tier: "micro",
    clusterId: spec.clusterId,
    x: spec.x,
    y: spec.y,
    z: spec.z,
    radius: spec.radius,
  },
  createdAt: new Date(),
}));

const CLUSTER_EDGES: KnowledgeEdge[] = CLUSTER_SPECS.flatMap((cluster, clusterIndex) => {
  const rootEdge: KnowledgeEdge = {
    id: `demo-edge-root-${cluster.id}`,
    fromObjectId: "demo-sentinel",
    toObjectId: `demo-${cluster.id}`,
    type: "related_to",
    weight: 1.8,
    metadata: { demo: true, accent: cluster.color },
  };
  const leafEdges = cluster.leaves.map((_, index): KnowledgeEdge => ({
    id: `demo-edge-${clusterIndex}-${index}`,
    fromObjectId: `demo-${cluster.id}`,
    toObjectId: `demo-${cluster.id}-${index}`,
    type: "belongs_to",
    weight: 1,
    metadata: { demo: true, accent: cluster.color },
  }));
  return [rootEdge, ...leafEdges];
});

const AMBIENT_EDGES: KnowledgeEdge[] = CLUSTER_SPECS.flatMap((cluster, index) => {
  const next = CLUSTER_SPECS[(index + 1) % CLUSTER_SPECS.length];
  return [
    {
      id: `demo-edge-ambient-a-${index}`,
      fromObjectId: `demo-${cluster.id}-${(index + 1) % cluster.leaves.length}`,
      toObjectId: `demo-${next.id}-${(index + 2) % next.leaves.length}`,
      type: "related_to",
      weight: 0.28,
      metadata: { demo: true, accent: "#334155" },
    },
    {
      id: `demo-edge-ambient-b-${index}`,
      fromObjectId: `demo-${cluster.id}-${(index + 3) % cluster.leaves.length}`,
      toObjectId: `demo-${next.id}-${(index + 4) % next.leaves.length}`,
      type: "references",
      weight: 0.2,
      metadata: { demo: true, accent: "#243247" },
    },
  ];
});

// Fine secondary pathways make the topology read as a neural mesh instead of
// a set of isolated spokes. They remain low-weight so the authored hierarchy
// and labels stay dominant.
const SYNAPTIC_EDGES: KnowledgeEdge[] = CLUSTER_SPECS.flatMap((cluster, clusterIndex) => {
  const local = cluster.leaves.flatMap((_, leafIndex) => {
    const nextIndex = (leafIndex + 1) % cluster.leaves.length;
    const skipIndex = (leafIndex + 2) % cluster.leaves.length;
    return [
      {
        id: `demo-edge-synapse-ring-${clusterIndex}-${leafIndex}`,
        fromObjectId: `demo-${cluster.id}-${leafIndex}`,
        toObjectId: `demo-${cluster.id}-${nextIndex}`,
        type: "references",
        weight: 0.18,
        metadata: { demo: true, synaptic: true, phase: leafIndex, accent: cluster.color },
      },
      {
        id: `demo-edge-synapse-skip-${clusterIndex}-${leafIndex}`,
        fromObjectId: `demo-${cluster.id}-${leafIndex}`,
        toObjectId: `demo-${cluster.id}-${skipIndex}`,
        type: "related_to",
        weight: 0.12,
        metadata: { demo: true, synaptic: true, phase: leafIndex + 3, accent: cluster.color },
      },
    ] satisfies KnowledgeEdge[];
  });
  const skipCluster = CLUSTER_SPECS[(clusterIndex + 2) % CLUSTER_SPECS.length];
  return [
    ...local,
    {
      id: `demo-edge-synapse-hub-${clusterIndex}`,
      fromObjectId: `demo-${cluster.id}`,
      toObjectId: `demo-${skipCluster.id}`,
      type: "related_to",
      weight: 0.14,
      metadata: { demo: true, synaptic: true, phase: clusterIndex + 7, accent: "#4f72a3" },
    },
  ];
});

const MICRO_EDGES: KnowledgeEdge[] = CLUSTER_SPECS.flatMap((cluster, clusterIndex) => {
  const count = MICRO_NODE_COUNT;
  return Array.from({ length: count }, (_, index) => {
    const nodeId = `demo-micro-${cluster.id}-${index}`;
    const nextId = `demo-micro-${cluster.id}-${(index + 1) % count}`;
    const skipId = `demo-micro-${cluster.id}-${(index + 5 + clusterIndex) % count}`;
    const leafId = `demo-${cluster.id}-${index % cluster.leaves.length}`;
    const accent = MICRO_SPECS[clusterIndex * count + index]?.color ?? "#7399b8";
    const shared = { demo: true, atmospheric: true, accent };
    return [
      {
        id: `demo-edge-micro-hub-${clusterIndex}-${index}`,
        fromObjectId: nodeId,
        toObjectId: index % 3 === 0 ? `demo-${cluster.id}` : leafId,
        type: "related_to",
        weight: 0.13,
        metadata: shared,
      },
      {
        id: `demo-edge-micro-next-${clusterIndex}-${index}`,
        fromObjectId: nodeId,
        toObjectId: nextId,
        type: "references",
        weight: 0.08,
        metadata: shared,
      },
      {
        id: `demo-edge-micro-skip-${clusterIndex}-${index}`,
        fromObjectId: nodeId,
        toObjectId: skipId,
        type: "related_to",
        weight: 0.06,
        metadata: shared,
      },
    ] satisfies KnowledgeEdge[];
  }).flat();
});

const MICRO_BRIDGES: KnowledgeEdge[] = CLUSTER_SPECS.flatMap((cluster, clusterIndex) => {
  const next = CLUSTER_SPECS[(clusterIndex + 1) % CLUSTER_SPECS.length];
  return Array.from({ length: 8 }, (_, index) => ({
    id: `demo-edge-micro-bridge-${clusterIndex}-${index}`,
    fromObjectId: `demo-micro-${cluster.id}-${(index * 3 + clusterIndex) % MICRO_NODE_COUNT}`,
    toObjectId: `demo-micro-${next.id}-${(index * 5 + 7) % MICRO_NODE_COUNT}`,
    type: "related_to" as const,
    weight: 0.05,
    metadata: {
      demo: true,
      atmospheric: true,
      accent: index % 3 === 0 ? "#4e8f72" : "#476983",
    },
  }));
});

const DEMO_EDGES: KnowledgeEdge[] = [
  ...CLUSTER_EDGES,
  ...AMBIENT_EDGES,
  ...SYNAPTIC_EDGES,
  ...MICRO_EDGES,
  ...MICRO_BRIDGES,
];

const DEMO_GRAPH: GraphData = { nodes: [...MICRO_NODES, ...DEMO_NODES], edges: DEMO_EDGES };

function endpointId(endpoint: unknown): string | null {
  if (typeof endpoint === "string") return endpoint;
  if (endpoint && typeof endpoint === "object" && "id" in endpoint) {
    return String((endpoint as { id: unknown }).id);
  }
  return null;
}

function driftPhase(id: string, salt: number): number {
  let hash = 2166136261 ^ salt;
  for (let index = 0; index < id.length; index += 1) {
    hash ^= id.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return ((hash >>> 0) / 4294967295) * Math.PI * 2;
}

function slowWave(elapsed: number, period: number, phase: number): number {
  return Math.sin((elapsed / period) * Math.PI * 2 + phase);
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function flyCameraToNode(graph: any, node: FGNode, distance: number) {
  if (!graph || node.x == null || node.y == null || node.z == null) return;
  const camera = graph.camera?.();
  const cameraPosition = camera?.position ?? { x: node.x, y: node.y, z: node.z + distance };
  const dx = cameraPosition.x - node.x;
  const dy = cameraPosition.y - node.y;
  const dz = cameraPosition.z - node.z;
  const length = Math.hypot(dx, dy, dz) || 1;
  graph.cameraPosition?.(
    {
      x: node.x + (dx / length) * distance,
      y: node.y + (dy / length) * distance,
      z: node.z + (dz / length) * distance,
    },
    { x: node.x, y: node.y, z: node.z },
    850
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function dollyCamera(graph: any, factor: number) {
  const camera = graph?.camera?.();
  const controls = graph?.controls?.();
  if (!camera?.position) return;
  const target = controls?.target ?? { x: 0, y: 0, z: 0 };
  graph.cameraPosition?.(
    {
      x: target.x + (camera.position.x - target.x) * factor,
      y: target.y + (camera.position.y - target.y) * factor,
      z: target.z + (camera.position.z - target.z) * factor,
    },
    { x: target.x, y: target.y, z: target.z },
    280
  );
}

/**
 * Full-screen interactive knowledge graph.
 *
 * The graph visualizes retrieved context, sources, entities, actions, and
 * approved reasoning summaries — never private chain-of-thought.
 */
export function KnowledgeGraph({
  roomId,
  projectId,
  isStreaming,
  refreshKey,
  onDataChange,
}: KnowledgeGraphProps) {
  const [graphData, setGraphData] = useState<GraphData>(DEMO_GRAPH);
  const [source, setSource] = useState<GraphSource>("demo");
  const [hoveredNodeId, setHoveredNodeId] = useState<string | null>(null);
  const [size, setSize] = useState({ width: 800, height: 600 });
  const containerRef = useRef<HTMLDivElement>(null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(undefined);
  const wasStreamingRef = useRef(false);

  const {
    search,
    activeTypes,
    focusMode,
    clustering,
    timeWindowCutoff,
    selectedNodeId,
    focusRequest,
    fitRequest,
    selectNode,
  } = useGraphStore();

  // ------------------------------------------------------------------ fetch
  const fetchGraph = useCallback(async () => {
    try {
      const params = new URLSearchParams();
      if (roomId) params.set("roomId", roomId);
      if (projectId) params.set("projectId", projectId);
      const res = await fetch(`/api/graph?${params.toString()}`);
      if (res.ok) {
        const data = (await res.json()) as GraphData;
        if (data.nodes.length > 0) {
          setGraphData(data);
          setSource("live");
        } else {
          setGraphData(DEMO_GRAPH);
          setSource("demo");
        }
      } else {
        setGraphData(DEMO_GRAPH);
        setSource("demo");
      }
    } catch {
      setGraphData(DEMO_GRAPH);
      setSource("offline");
    }
  }, [roomId, projectId]);

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

  // Refetch on knowledge_update SSE events
  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (refreshKey !== undefined && refreshKey > 0) void fetchGraph();
  }, [refreshKey, fetchGraph]);

  // Gentle polling keeps the graph live
  useEffect(() => {
    const id = setInterval(() => void fetchGraph(), 8000);
    return () => clearInterval(id);
  }, [fetchGraph]);

  useEffect(() => {
    onDataChange?.(graphData, source);
  }, [graphData, source, onDataChange]);

  // ------------------------------------------------------------------ size
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

  // ---------------------------------------------------------------- derive
  const degreeMap = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of graphData.edges) {
      map.set(e.fromObjectId, (map.get(e.fromObjectId) ?? 0) + 1);
      map.set(e.toObjectId, (map.get(e.toObjectId) ?? 0) + 1);
    }
    return map;
  }, [graphData.edges]);

  const filteredNodes = useMemo(() => {
    return graphData.nodes.filter((n) => {
      if (search && !n.title.toLowerCase().includes(search.toLowerCase())) return false;
      if (activeTypes.size > 0 && !activeTypes.has(n.type)) return false;
      if (timeWindowCutoff > 0 && new Date(n.createdAt).getTime() < timeWindowCutoff)
        return false;
      return true;
    });
  }, [graphData.nodes, search, activeTypes, timeWindowCutoff]);

  const filteredNodeIds = useMemo(
    () => new Set(filteredNodes.map((n) => n.id)),
    [filteredNodes]
  );

  const filteredEdges = useMemo(
    () =>
      graphData.edges.filter(
        (e) => filteredNodeIds.has(e.fromObjectId) && filteredNodeIds.has(e.toObjectId)
      ),
    [graphData.edges, filteredNodeIds]
  );

  const neighborsOfSelected = useMemo(() => {
    if (!selectedNodeId) return null;
    const set = new Set<string>([selectedNodeId]);
    for (const e of filteredEdges) {
      if (e.fromObjectId === selectedNodeId) set.add(e.toObjectId);
      if (e.toObjectId === selectedNodeId) set.add(e.fromObjectId);
    }
    return set;
  }, [selectedNodeId, filteredEdges]);

  // Approved reasoning-summary hubs + their neighbors pulse while the agent is
  // active. This visualizes retrieved context and actions, never private CoT.
  const pulseIds = useMemo(() => {
    if (!isStreaming) return null;
    const activeContext = new Set(
      filteredNodes
        .filter((n) => n.type === "Agent" || n.type === "Memory" || n.type === "Task")
        .map((n) => n.id)
    );
    const set = new Set(activeContext);
    for (const e of filteredEdges) {
      if (activeContext.has(e.fromObjectId)) set.add(e.toObjectId);
      if (activeContext.has(e.toObjectId)) set.add(e.fromObjectId);
    }
    return set;
  }, [isStreaming, filteredNodes, filteredEdges]);

  const fgData = useMemo(() => {
    const nodes: FGNode[] = filteredNodes.map((n) => {
      const degree = degreeMap.get(n.id) ?? 0;
      const metadata = n.metadata as {
        demo?: boolean;
        x?: number;
        y?: number;
        z?: number;
        tier?: DemoTier;
        radius?: number;
      };
      const radius = metadata.tier === "root"
        ? 25
        : metadata.tier === "hub"
          ? 9
          : metadata.tier === "leaf"
            ? 3.6
            : metadata.tier === "micro"
              ? metadata.radius ?? 1.4
              : nodeRadius(n.type, degree);
      return {
        ...n,
        id: n.id,
        label: n.title,
        type: n.type,
        color: nodeColor(n),
        radius,
        degree,
        createdAt: n.createdAt,
        metadata: n.metadata,
        ...(metadata.demo && typeof metadata.x === "number" && typeof metadata.y === "number" && typeof metadata.z === "number"
          ? { x: metadata.x, y: metadata.y, z: metadata.z, fx: metadata.x, fy: metadata.y, fz: metadata.z }
          : {}),
      };
    });
    const tierRank: Record<DemoTier, number> = { micro: 0, leaf: 1, hub: 2, root: 3 };
    nodes.sort((a, b) => {
      const aTier = (a.metadata as { tier?: DemoTier }).tier ?? "leaf";
      const bTier = (b.metadata as { tier?: DemoTier }).tier ?? "leaf";
      return tierRank[aTier] - tierRank[bTier];
    });
    const links = filteredEdges.map((e) => ({
      source: e.fromObjectId,
      target: e.toObjectId,
      type: e.type,
      weight: e.weight,
      color: (e.metadata as { accent?: string } | undefined)?.accent,
      synaptic: Boolean((e.metadata as { synaptic?: boolean } | undefined)?.synaptic),
      atmospheric: Boolean((e.metadata as { atmospheric?: boolean } | undefined)?.atmospheric),
      phase: Number((e.metadata as { phase?: number } | undefined)?.phase ?? 0),
    }));
    return { nodes, links };
  }, [filteredNodes, filteredEdges, degreeMap]);

  // Bounded quasi-chaotic drift. Several incommensurate waves pull each
  // cluster in different directions, so the topology wanders and regroups
  // without tracing obvious circles. Shared cluster motion preserves the
  // authored hierarchy while each leaf gets a small independent current.
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const root = fgData.nodes.find(
      (node) => (node.metadata as { tier?: DemoTier }).tier === "root"
    );
    if (!root) return;

    const rootMetadata = root.metadata as { x?: number; y?: number; z?: number };
    const rootX = rootMetadata.x ?? 0;
    const rootY = rootMetadata.y ?? 0;
    const rootZ = rootMetadata.z ?? 0;
    const clusterOrder = new Map(CLUSTER_SPECS.map((cluster, index) => [cluster.id, index]));
    const startedAt = performance.now();
    let frame = 0;
    let lastPaint = 0;
    const animate = (time: number) => {
      if (time - lastPaint >= 34) {
        const elapsed = time - startedAt;
        for (const node of fgData.nodes) {
          const metadata = node.metadata as {
            demo?: boolean;
            x?: number;
            y?: number;
            z?: number;
            tier?: DemoTier;
            clusterId?: string;
          };
          if (!metadata.demo || metadata.x == null || metadata.y == null || metadata.z == null) continue;

          const rootDriftX =
            slowWave(elapsed, 73_000, 0.4) * 4.5 +
            slowWave(elapsed, 131_000, 2.2) * 2.5;
          const rootDriftY =
            slowWave(elapsed, 89_000, 2.7) * 4 +
            slowWave(elapsed, 113_000, 0.9) * 2.75;
          const rootDriftZ =
            slowWave(elapsed, 97_000, 1.7) * 4.2 +
            slowWave(elapsed, 149_000, 3.4) * 2.4;

          let x = rootX + rootDriftX;
          let y = rootY + rootDriftY;
          let z = rootZ + rootDriftZ;
          if (metadata.tier !== "root" && metadata.clusterId) {
            const clusterIndex = clusterOrder.get(metadata.clusterId) ?? 0;
            const clusterPhaseX = driftPhase(metadata.clusterId, 17);
            const clusterPhaseY = driftPhase(metadata.clusterId, 41);
            const clusterPhaseZ = driftPhase(metadata.clusterId, 59);
            const expansion = 1 + slowWave(elapsed, 109_000, clusterPhaseX + 0.8) * 0.035;
            const anchorX = rootX + (metadata.x - rootX) * expansion;
            const anchorY = rootY + (metadata.y - rootY) * expansion;
            const anchorZ = rootZ + (metadata.z - rootZ) * expansion;

            const clusterDriftX =
              slowWave(elapsed, 67_000 + clusterIndex * 3_700, clusterPhaseX) * 17 +
              slowWave(elapsed, 127_000 + clusterIndex * 5_300, clusterPhaseY + 1.4) * 9 +
              slowWave(elapsed, 43_000 + clusterIndex * 2_100, clusterPhaseX + 2.8) * 4;
            const clusterDriftY =
              slowWave(elapsed, 79_000 + clusterIndex * 4_100, clusterPhaseY) * 15 +
              slowWave(elapsed, 137_000 + clusterIndex * 4_700, clusterPhaseX + 2.1) * 10 +
              slowWave(elapsed, 51_000 + clusterIndex * 2_300, clusterPhaseY + 3.2) * 4;
            const clusterDriftZ =
              slowWave(elapsed, 83_000 + clusterIndex * 3_900, clusterPhaseZ) * 16 +
              slowWave(elapsed, 143_000 + clusterIndex * 5_100, clusterPhaseX + 0.7) * 9 +
              slowWave(elapsed, 57_000 + clusterIndex * 2_500, clusterPhaseY + 2.6) * 4;

            x = anchorX + rootDriftX * 0.35 + clusterDriftX;
            y = anchorY + rootDriftY * 0.35 + clusterDriftY;
            z = anchorZ + rootDriftZ * 0.35 + clusterDriftZ;

            if (metadata.tier === "leaf" || metadata.tier === "micro") {
              const nodePhaseX = driftPhase(node.id, 73);
              const nodePhaseY = driftPhase(node.id, 101);
              const nodePhaseZ = driftPhase(node.id, 137);
              const driftScale = metadata.tier === "micro" ? 0.62 : 1;
              x +=
                (slowWave(elapsed, 47_000 + clusterIndex * 1_900, nodePhaseX) * 7 +
                  slowWave(elapsed, 91_000 + clusterIndex * 2_600, nodePhaseY + 1.1) * 3) * driftScale;
              y +=
                (slowWave(elapsed, 59_000 + clusterIndex * 1_700, nodePhaseY) * 6 +
                  slowWave(elapsed, 103_000 + clusterIndex * 2_200, nodePhaseX + 2.4) * 3.5) * driftScale;
              z +=
                (slowWave(elapsed, 53_000 + clusterIndex * 2_000, nodePhaseZ) * 6.5 +
                  slowWave(elapsed, 111_000 + clusterIndex * 2_400, nodePhaseY + 1.9) * 3.2) * driftScale;
            }
          }

          node.x = x;
          node.y = y;
          node.z = z;
          node.fx = x;
          node.fy = y;
          node.fz = z;
        }
        fgRef.current?.refresh?.();
        lastPaint = time;
      }
      frame = window.requestAnimationFrame(animate);
    };

    frame = window.requestAnimationFrame(animate);
    return () => window.cancelAnimationFrame(frame);
  }, [fgData.nodes]);

  // ------------------------------------------------------- cluster force
  useEffect(() => {
    const fg = fgRef.current;
    if (!fg) return;
    if (clustering) {
      const centers = new Map<string, { x: number; y: number; z: number }>();
      const groups = Array.from(new Set(fgData.nodes.map((n) => n.color)));
      const R = Math.min(size.width, size.height) * 0.28;
      groups.forEach((g, i) => {
        const angle = (i / Math.max(1, groups.length)) * Math.PI * 2;
        centers.set(g, {
          x: Math.cos(angle) * R,
          y: Math.sin(angle) * R,
          z: Math.sin(angle * 1.7) * R * 0.65,
        });
      });
      const clusterForce = (alpha: number) => {
        for (const node of fgData.nodes) {
          const c = centers.get(node.color);
          if (!c || node.x == null || node.y == null || node.z == null) continue;
          node.vx = ((node.vx as number) ?? 0) + (c.x - node.x) * alpha * 0.08;
          node.vy = ((node.vy as number) ?? 0) + (c.y - node.y) * alpha * 0.08;
          node.vz = ((node.vz as number) ?? 0) + (c.z - node.z) * alpha * 0.08;
        }
      };
      fg.d3Force("cluster", clusterForce);
    } else {
      fg.d3Force("cluster", null);
    }
    fg.d3ReheatSimulation?.();
  }, [clustering, fgData.nodes, size.width, size.height]);

  // ------------------------------------------------------- focus requests
  useEffect(() => {
    if (!focusRequest) return;
    const target = graphData.nodes.find((n) =>
      n.title.toLowerCase().includes(focusRequest.title.toLowerCase())
    );
    if (!target) return;
    selectNode(target.id);
    const fgNode = fgData.nodes.find((n) => n.id === target.id);
    if (fgNode) flyCameraToNode(fgRef.current, fgNode, 92);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  // Initial fit
  useEffect(() => {
    if (fgData.nodes.length === 0) return;
    const frame = window.setTimeout(() => fgRef.current?.zoomToFit?.(900, 44), 550);
    return () => window.clearTimeout(frame);
  }, [fgData.nodes.length]);

  // Toolbar-requested fit
  useEffect(() => {
    if (fitRequest > 0) fgRef.current?.zoomToFit?.(720, 44);
  }, [fitRequest]);

  // ------------------------------------------------------------- drawing
  const nodeCanvasObject = useCallback(
    (node: object, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const n = node as FGNode;
      const x = n.x ?? 0;
      const y = n.y ?? 0;
      const meta = n.metadata as { tier?: DemoTier; atmospheric?: boolean };
      const tier = meta.tier;
      const isSelected = selectedNodeId === n.id;
      const isHovered = hoveredNodeId === n.id;
      const isPulsing = pulseIds?.has(n.id) ?? false;
      const dimmed = Boolean(focusMode && neighborsOfSelected && !neighborsOfSelected.has(n.id));
      const emphasis = isSelected ? 1.2 : isHovered ? 1.1 : 1;
      const pulse = isPulsing ? 1 + Math.sin(Date.now() * 0.004 + x * 0.01) * 0.1 : 1;
      const r = n.radius * emphasis * pulse;
      const progressiveAlpha =
        tier !== "leaf" || isSelected || isHovered
          ? 1
          : globalScale < 0.42
            ? 0.16
            : globalScale < 0.62
              ? 0.7
              : 0.94;

      ctx.save();
      ctx.globalAlpha = dimmed ? 0.1 : progressiveAlpha;

      if (tier === "micro") {
        ctx.globalAlpha = dimmed ? 0.04 : globalScale < 0.42 ? 0.38 : 0.76;
        ctx.beginPath();
        ctx.arc(x, y, r, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.shadowColor = n.color;
        ctx.shadowBlur = r > 2 ? 5 : 2.5;
        ctx.fill();
        ctx.shadowBlur = 0;
        ctx.beginPath();
        ctx.arc(x - r * 0.22, y - r * 0.22, Math.max(0.35, r * 0.3), 0, Math.PI * 2);
        ctx.fillStyle = "rgba(222,241,247,0.72)";
        ctx.fill();
        ctx.restore();
        return;
      }

      if (tier === "root") {
        const halo = r + 12 + Math.sin(Date.now() * 0.0016) * 1.4;
        const gradient = ctx.createRadialGradient(x, y, r * 0.4, x, y, halo);
        gradient.addColorStop(0, "rgba(47,140,255,0.75)");
        gradient.addColorStop(0.55, "rgba(47,140,255,0.16)");
        gradient.addColorStop(1, "rgba(47,140,255,0)");
        ctx.beginPath();
        ctx.arc(x, y, halo, 0, Math.PI * 2);
        ctx.fillStyle = gradient;
        ctx.fill();
        ctx.beginPath();
        ctx.arc(x, y, r + 4, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(129,190,255,0.78)";
        ctx.lineWidth = 1.2;
        ctx.stroke();
      }

      ctx.beginPath();
      ctx.arc(x, y, r, 0, Math.PI * 2);
      ctx.fillStyle = n.color;
      ctx.shadowColor = n.color;
      ctx.shadowBlur = tier === "root" ? 22 : tier === "hub" ? 12 : 7;
      ctx.fill();
      ctx.shadowBlur = 0;

      ctx.beginPath();
      ctx.arc(x, y, Math.max(1.2, r * 0.42), 0, Math.PI * 2);
      ctx.fillStyle = tier === "root" ? "#e6f3ff" : "rgba(255,255,255,0.72)";
      ctx.fill();

      if (tier === "root") {
        ctx.textAlign = "center";
        ctx.font = `700 ${10 / globalScale}px ui-sans-serif, system-ui`;
        ctx.fillStyle = "#2176d9";
        ctx.fillText("S", x, y + 3.5 / globalScale);
        const titleSize = 11.5 / globalScale;
        const subtitleSize = 7 / globalScale;
        ctx.textAlign = "center";
        ctx.font = `600 ${titleSize}px ui-sans-serif, system-ui`;
        ctx.fillStyle = "#f3f8ff";
        ctx.fillText(n.label, x, y + r + titleSize + 4 / globalScale);
        ctx.font = `${subtitleSize}px ui-sans-serif, system-ui`;
        ctx.fillStyle = "#8fa1b7";
        ctx.fillText("Intelligence Platform", x, y + r + titleSize + subtitleSize + 7 / globalScale);
      } else if (tier === "hub") {
        const fontSize = 11 / globalScale;
        ctx.font = `600 ${fontSize}px ui-sans-serif, system-ui`;
        ctx.textAlign = "center";
        ctx.fillStyle = "#e9f0f8";
        ctx.shadowColor = "#020711";
        ctx.shadowBlur = 4;
        ctx.fillText(n.label, x, y + r + fontSize + 3 / globalScale);
        ctx.shadowBlur = 0;
      } else if (tier === "leaf" && (globalScale > 1.18 || isSelected || isHovered)) {
        const fontSize = 7.2 / globalScale;
        const padX = 5 / globalScale;
        const boxHeight = 15 / globalScale;
        ctx.font = `500 ${fontSize}px ui-sans-serif, system-ui`;
        const textWidth = ctx.measureText(n.label).width;
        const boxWidth = textWidth + padX * 2 + 10 / globalScale;
        const boxX = x + r + 3 / globalScale;
        const boxY = y - boxHeight / 2;
        ctx.beginPath();
        ctx.roundRect(boxX, boxY, boxWidth, boxHeight, 4 / globalScale);
        ctx.fillStyle = "rgba(7,17,29,0.9)";
        ctx.fill();
        ctx.strokeStyle = `${n.color}55`;
        ctx.lineWidth = 0.55 / globalScale;
        ctx.stroke();
        ctx.beginPath();
        ctx.arc(boxX + 5 / globalScale, y, 2.2 / globalScale, 0, Math.PI * 2);
        ctx.fillStyle = n.color;
        ctx.fill();
        ctx.textAlign = "left";
        ctx.fillStyle = "#cbd5e1";
        ctx.fillText(n.label, boxX + 10 / globalScale, y + fontSize * 0.35);
      }

      if (isSelected || isHovered) {
        ctx.beginPath();
        ctx.arc(x, y, r + 3, 0, Math.PI * 2);
        ctx.strokeStyle = "rgba(255,255,255,0.9)";
        ctx.lineWidth = 0.8;
        ctx.stroke();
      }
      ctx.restore();
    },
    [selectedNodeId, hoveredNodeId, pulseIds, focusMode, neighborsOfSelected]
  );

  const isHighlightedLink = useCallback(
    (link: { source: unknown; target: unknown }) => {
      const s = endpointId(link.source);
      const t = endpointId(link.target);
      if (hoveredNodeId && (s === hoveredNodeId || t === hoveredNodeId)) return true;
      if (selectedNodeId && (s === selectedNodeId || t === selectedNodeId)) return true;
      return false;
    },
    [hoveredNodeId, selectedNodeId]
  );

  const isPulseLink = useCallback(
    (link: { source: unknown; target: unknown }) => {
      if (!pulseIds) return false;
      const sourceId = endpointId(link.source);
      const targetId = endpointId(link.target);
      return Boolean(
        (sourceId && pulseIds.has(sourceId)) || (targetId && pulseIds.has(targetId))
      );
    },
    [pulseIds]
  );

  const handleNodeClick = useCallback(
    (node: object) => {
      const n = node as FGNode;
      selectNode(n.id);
      const tier = (n.metadata as { tier?: DemoTier }).tier;
      flyCameraToNode(
        fgRef.current,
        n,
        tier === "micro" ? 34 : tier === "leaf" ? 54 : tier === "hub" ? 96 : 150
      );
    },
    [selectNode]
  );

  return (
    <div
      ref={containerRef}
      className="neural-space-canvas absolute inset-0 overflow-hidden"
      role="application"
      aria-label="Knowledge graph canvas"
    >
      <ForceGraph3D
        ref={fgRef}
        graphData={fgData}
        backgroundColor="#02030a"
        showNavInfo={false}
        controlType="orbit"
        numDimensions={3}
        nodeLabel={(node) => (node as FGNode).metadata && (node as FGNode).metadata.tier === "micro" ? "" : (node as FGNode).label}
        nodeVal={(node) => {
          const n = node as FGNode;
          const tier = (n.metadata as { tier?: DemoTier }).tier;
          const emphasis = selectedNodeId === n.id ? 2.6 : hoveredNodeId === n.id ? 1.7 : 1;
          const scale = tier === "root" ? 2.7 : tier === "hub" ? 1.45 : 1;
          return Math.max(0.22, n.radius * scale * emphasis);
        }}
        nodeColor={(node) => {
          const n = node as FGNode;
          if (focusMode && neighborsOfSelected && !neighborsOfSelected.has(n.id)) return "#0b1020";
          if (selectedNodeId === n.id) return "#fff7ff";
          return n.color;
        }}
        nodeRelSize={2.05}
        nodeOpacity={0.94}
        nodeResolution={8}
        linkColor={(link) => {
          const typedLink = link as { source: unknown; target: unknown; color?: string; synaptic?: boolean; atmospheric?: boolean };
          if (isHighlightedLink(typedLink)) return "#c9f3ff";
          if (typedLink.color) return typedLink.color;
          return "#36516f";
        }}
        linkOpacity={0.22}
        linkWidth={(link) => {
          const typedLink = link as { source: unknown; target: unknown; weight?: number; synaptic?: boolean; atmospheric?: boolean };
          if (isHighlightedLink(typedLink)) return 1.25;
          if (typedLink.atmospheric) return 0.13;
          if (typedLink.synaptic) return 0.22;
          return Math.max(0.28, Number(typedLink.weight ?? 1) * 0.48);
        }}
        linkCurvature={(link) => {
          const typedLink = link as { synaptic?: boolean; atmospheric?: boolean };
          return typedLink.atmospheric ? 0.018 : typedLink.synaptic ? 0.09 : 0.035;
        }}
        linkDirectionalParticles={(link) => {
          const typedLink = link as { source: unknown; target: unknown; synaptic?: boolean };
          if (isStreaming && isPulseLink(typedLink)) return 2;
          return typedLink.synaptic ? 1 : 0;
        }}
        linkDirectionalParticleWidth={(link) => (link as { synaptic?: boolean }).synaptic ? 0.72 : 1.2}
        linkDirectionalParticleSpeed={(link) => {
          const typedLink = link as { synaptic?: boolean; phase?: number };
          return typedLink.synaptic ? 0.0014 + (typedLink.phase ?? 0) % 4 * 0.00018 : 0.004;
        }}
        linkDirectionalParticleColor={(link) => {
          const typedLink = link as { synaptic?: boolean; color?: string };
          return typedLink.synaptic && typedLink.color ? typedLink.color : GRAPH_COLORS.pulse;
        }}
        onNodeClick={handleNodeClick}
        onNodeHover={(node) => setHoveredNodeId((node as FGNode | null)?.id ?? null)}
        onNodeDragEnd={(node) => {
          const n = node as FGNode;
          n.fx = n.x;
          n.fy = n.y;
          n.fz = n.z;
        }}
        onBackgroundClick={() => selectNode(null)}
        warmupTicks={18}
        cooldownTicks={64}
        d3AlphaDecay={0.035}
        d3VelocityDecay={0.38}
        width={size.width}
        height={size.height}
        enableNavigationControls
        enablePointerInteraction
      />

      <div className="pointer-events-none absolute bottom-14 left-1/2 z-20 hidden -translate-x-1/2 items-center gap-3 rounded-full border border-white/[0.06] bg-[#050813]/72 px-3 py-1.5 text-[8px] uppercase tracking-[0.14em] text-[#6f8196] backdrop-blur-xl lg:flex">
        <span>Drag to rotate</span><span className="h-1 w-1 rounded-full bg-cyan-300/50" /><span>Scroll to dive</span><span className="h-1 w-1 rounded-full bg-fuchsia-300/50" /><span>Click a node to focus</span>
      </div>

      <GraphMinimap fgRef={fgRef} nodes={fgData.nodes} size={size} />

      {filteredNodes.length === 0 && (
        <div className="pointer-events-none absolute inset-0 z-10 flex items-center justify-center px-8">
          <div className="max-w-xs rounded-xl border border-white/[0.08] bg-[#0b0f17]/90 px-5 py-4 text-center shadow-2xl backdrop-blur-xl">
            <div className="text-xs font-medium text-[#e8eaed]">
              {source === "offline" ? "Knowledge graph offline" : "Nothing matches"}
            </div>
            <div className="mt-1.5 text-[10px] leading-4 text-[#697084]">
              {source === "offline"
                ? "The graph service is unreachable. Showing cached demo topology."
                : "Adjust search, filters, or the time window to reveal nodes."}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Minimap — lightweight overview with viewport indicator
// ---------------------------------------------------------------------------

function GraphMinimap({
  fgRef,
  nodes,
  size,
}: {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  fgRef: React.MutableRefObject<any>;
  nodes: FGNode[];
  size: { width: number; height: number };
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [locked, setLocked] = useState(false);
  const W = 148;
  const H = 132;

  useEffect(() => {
    let raf = 0;
    let last = 0;
    const draw = (t: number) => {
      raf = requestAnimationFrame(draw);
      if (t - last < 250) return; // ~4fps is plenty for an overview
      last = t;
      const canvas = canvasRef.current;
      const ctx = canvas?.getContext("2d");
      if (!canvas || !ctx || nodes.length === 0) return;

      const xs = nodes.map((n) => n.x ?? 0);
      const ys = nodes.map((n) => n.y ?? 0);
      const minX = Math.min(...xs) - 20;
      const maxX = Math.max(...xs) + 20;
      const minY = Math.min(...ys) - 20;
      const maxY = Math.max(...ys) + 20;
      const scale = Math.min(W / (maxX - minX), H / (maxY - minY));
      const ox = (W - (maxX - minX) * scale) / 2;
      const oy = (H - (maxY - minY) * scale) / 2;

      ctx.clearRect(0, 0, W, H);
      for (const n of nodes) {
        ctx.beginPath();
        ctx.arc(
          ox + ((n.x ?? 0) - minX) * scale,
          oy + ((n.y ?? 0) - minY) * scale,
          Math.max(0.8, n.radius * scale * 0.6),
          0,
          Math.PI * 2
        );
        ctx.fillStyle = n.color;
        ctx.globalAlpha = 0.85;
        ctx.fill();
      }

      // Viewport rectangle
      try {
        const k: number = fgRef.current?.zoom?.() ?? 1;
        const center: { x: number; y: number } =
          fgRef.current?.centerAt?.() ?? { x: 0, y: 0 };
        const vw = (size.width / k) * scale;
        const vh = (size.height / k) * scale;
        const vx = ox + (center.x - minX) * scale - vw / 2;
        const vy = oy + (center.y - minY) * scale - vh / 2;
        ctx.globalAlpha = 1;
        ctx.strokeStyle = "rgba(255,255,255,0.35)";
        ctx.lineWidth = 1;
        ctx.strokeRect(vx, vy, vw, vh);
      } catch {
        // viewport getters unavailable — skip indicator
      }
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [fgRef, nodes, size.width, size.height]);

  return (
    <div className="pointer-events-auto absolute bottom-14 right-3 z-20 hidden overflow-hidden rounded-xl border border-[#203248] bg-[#07131f]/92 p-1.5 shadow-2xl backdrop-blur-xl md:block">
      <canvas ref={canvasRef} width={W} height={H} aria-label="Graph minimap" />
      <div className="mt-1.5 flex items-center gap-1 border-t border-white/[0.055] pt-1.5">
        <button type="button" aria-label="Zoom out" onClick={() => dollyCamera(fgRef.current, 1.22)} className="flex h-6 w-6 items-center justify-center rounded text-[#8795a8] hover:bg-white/[0.06] hover:text-white"><Minus className="h-3 w-3" /></button>
        <div className="h-1 flex-1 rounded-full bg-white/[0.08]"><div className="h-full w-1/2 rounded-full bg-sky-400" /></div>
        <button type="button" aria-label="Zoom in" onClick={() => dollyCamera(fgRef.current, 0.82)} className="flex h-6 w-6 items-center justify-center rounded text-[#8795a8] hover:bg-white/[0.06] hover:text-white"><Plus className="h-3 w-3" /></button>
        <button type="button" aria-label="Fit graph" onClick={() => fgRef.current?.zoomToFit?.(420, 90)} className="flex h-6 w-6 items-center justify-center rounded text-[#8795a8] hover:bg-white/[0.06] hover:text-white"><Maximize2 className="h-3 w-3" /></button>
        <button type="button" aria-label="Lock graph viewport" aria-pressed={locked} onClick={() => {
          setLocked((value) => {
            const next = !value;
            const controls = fgRef.current?.controls?.();
            if (controls) controls.enabled = !next;
            return next;
          });
        }} className={cn("flex h-6 w-6 items-center justify-center rounded hover:bg-white/[0.06] hover:text-white", locked ? "text-cyan-300" : "text-[#8795a8]")}><Lock className="h-3 w-3" /></button>
      </div>
    </div>
  );
}
