"use client";

import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from "react";
import {
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Panel,
  Position,
  ReactFlow,
  addEdge,
  useEdgesState,
  useNodesState,
  type Connection,
  type Edge,
  type Node,
  type NodeTypes,
  type ReactFlowInstance,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  Bot,
  Building2,
  Check,
  CircleDot,
  Download,
  GitBranch,
  Grid3X3,
  LayoutDashboard,
  Network,
  Redo2,
  Save,
  Search,
  Trash2,
  Undo2,
  Upload,
  UserRound,
  Users,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";

type OrgNodeKind = "person" | "agent" | "team" | "department";
type LayoutMode = "hierarchy" | "radial" | "freeform";

interface OrgNodeData extends Record<string, unknown> {
  label: string;
  subtitle: string;
  department: string;
  status: string;
  accent: string;
  avatar?: string;
}

type OrgNode = Node<OrgNodeData, OrgNodeKind>;
type OrgEdge = Edge;
type Snapshot = { nodes: OrgNode[]; edges: OrgEdge[] };

const KIND_META: Record<
  OrgNodeKind,
  { label: string; accent: string; icon: typeof UserRound }
> = {
  person: { label: "Person", accent: "#38bdf8", icon: UserRound },
  agent: { label: "AI Agent", accent: "#8b5cf6", icon: Bot },
  team: { label: "Team", accent: "#f59e0b", icon: Users },
  department: { label: "Department", accent: "#22c55e", icon: Building2 },
};

function OrgNodeCard({
  data,
  selected,
  kind,
}: {
  data: OrgNodeData;
  selected: boolean;
  kind: OrgNodeKind;
}) {
  const meta = KIND_META[kind];
  const Icon = meta.icon;
  const accent = data.accent || meta.accent;

  return (
    <div
      className={cn(
        "group relative min-w-[174px] rounded-xl border bg-[#07131f]/96 px-3 py-2.5 shadow-[0_14px_45px_rgba(0,0,0,0.34)] backdrop-blur-xl transition-[border-color,box-shadow,transform]",
        selected
          ? "border-violet-400 shadow-[0_0_0_1px_rgba(167,139,250,0.32),0_0_32px_rgba(124,58,237,0.24)]"
          : "border-[#1b334b] hover:border-[#315577]"
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!h-2 !w-2 !border-2 !border-[#06101b]"
        style={{ background: accent }}
      />
      <Handle
        type="source"
        position={Position.Bottom}
        className="!h-2 !w-2 !border-2 !border-[#06101b]"
        style={{ background: accent }}
      />
      <Handle
        id="side"
        type="source"
        position={Position.Right}
        className="!h-2 !w-2 !border-2 !border-[#06101b]"
        style={{ background: accent }}
      />

      <div className="flex items-center gap-2.5">
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg border"
          style={{
            color: accent,
            borderColor: `${accent}55`,
            background: `${accent}18`,
            boxShadow: `0 0 18px ${accent}22`,
          }}
        >
          {data.avatar ? (
            <span className="text-base">{data.avatar}</span>
          ) : (
            <Icon className="h-4 w-4" />
          )}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[12px] font-semibold text-[#eef5ff]">
            {data.label}
          </div>
          <div className="mt-0.5 truncate text-[9.5px] text-[#8190a4]">
            {data.subtitle}
          </div>
        </div>
        <span
          className="h-1.5 w-1.5 shrink-0 rounded-full"
          style={{ background: accent, boxShadow: `0 0 9px ${accent}` }}
        />
      </div>
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-white/[0.055] pt-1.5 text-[8.5px] text-[#607086]">
        <span className="truncate">{data.department || meta.label}</span>
        <span className="shrink-0 text-[#93a4ba]">{data.status || "Active"}</span>
      </div>
    </div>
  );
}

const nodeTypes: NodeTypes = {
  person: (props) => (
    <OrgNodeCard
      data={props.data as OrgNodeData}
      selected={props.selected}
      kind="person"
    />
  ),
  agent: (props) => (
    <OrgNodeCard
      data={props.data as OrgNodeData}
      selected={props.selected}
      kind="agent"
    />
  ),
  team: (props) => (
    <OrgNodeCard
      data={props.data as OrgNodeData}
      selected={props.selected}
      kind="team"
    />
  ),
  department: (props) => (
    <OrgNodeCard
      data={props.data as OrgNodeData}
      selected={props.selected}
      kind="department"
    />
  ),
};

const DEFAULT_NODES: OrgNode[] = [];

const edgeStyle = { stroke: "#6aa9df", strokeWidth: 1.15 };

const DEFAULT_EDGES: OrgEdge[] = [];

function cloneSnapshot(nodes: OrgNode[], edges: OrgEdge[]): Snapshot {
  return {
    nodes: nodes.map((node) => ({ ...node, position: { ...node.position }, data: { ...node.data } })),
    edges: edges.map((edge) => ({ ...edge, style: edge.style ? { ...edge.style } : undefined })),
  };
}

function layoutNodes(nodes: OrgNode[], edges: OrgEdge[], mode: LayoutMode): OrgNode[] {
  if (mode === "freeform") return nodes;

  if (mode === "radial") {
    const center = { x: 520, y: 310 };
    const root = nodes.find((node) => !edges.some((edge) => edge.target === node.id));
    const peers = nodes.filter((node) => node.id !== root?.id);
    return nodes.map((node) => {
      if (node.id === root?.id) return { ...node, position: center };
      const index = peers.findIndex((peer) => peer.id === node.id);
      const angle = (index / Math.max(1, peers.length)) * Math.PI * 2 - Math.PI / 2;
      const ring = index < 4 ? 210 : 330;
      return {
        ...node,
        position: {
          x: center.x + Math.cos(angle) * ring,
          y: center.y + Math.sin(angle) * ring * 0.72,
        },
      };
    });
  }

  const incoming = new Map<string, string[]>();
  edges.forEach((edge) => incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge.source]));
  const levelOf = (id: string, seen = new Set<string>()): number => {
    if (seen.has(id)) return 0;
    const parents = incoming.get(id) ?? [];
    if (!parents.length) return 0;
    seen.add(id);
    return 1 + Math.max(...parents.map((parent) => levelOf(parent, new Set(seen))));
  };
  const levels = new Map<number, OrgNode[]>();
  nodes.forEach((node) => {
    const level = Math.min(4, levelOf(node.id));
    levels.set(level, [...(levels.get(level) ?? []), node]);
  });
  return nodes.map((node) => {
    const level = Math.min(4, levelOf(node.id));
    const peers = levels.get(level) ?? [];
    const index = peers.findIndex((peer) => peer.id === node.id);
    const gap = 238;
    return {
      ...node,
      position: {
        x: 520 + (index - (peers.length - 1) / 2) * gap,
        y: 30 + level * 172,
      },
    };
  });
}

function ToolbarButton({
  label,
  onClick,
  disabled,
  active,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  active?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
      className={cn(
        "flex h-8 items-center justify-center gap-1.5 rounded-lg border px-2.5 text-[10px] font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-35",
        active
          ? "border-violet-400/45 bg-violet-500/20 text-violet-200"
          : "border-[#1b3047] bg-[#091522] text-[#8d9caf] hover:border-[#315271] hover:text-white"
      )}
    >
      {children}
    </button>
  );
}

function Inspector({
  node,
  onUpdate,
  onDelete,
  onClose,
}: {
  node: OrgNode;
  onUpdate: (id: string, data: OrgNodeData, kind: OrgNodeKind) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const [form, setForm] = useState<OrgNodeData>({ ...node.data });
  const [kind, setKind] = useState<OrgNodeKind>(node.type ?? "person");

  const field = (key: keyof OrgNodeData, label: string) => (
    <label className="block">
      <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[#617188]">
        {label}
      </span>
      <input
        value={String(form[key] ?? "")}
        onChange={(event) => setForm((value) => ({ ...value, [key]: event.target.value }))}
        className="h-8 w-full rounded-lg border border-[#1b3047] bg-[#08131f] px-2.5 text-[11px] text-[#dce6f2] outline-none transition-colors focus:border-violet-400/70"
      />
    </label>
  );

  return (
    <aside className="absolute inset-y-0 right-0 z-30 flex w-[292px] flex-col border-l border-[#18304a] bg-[#06101b]/97 shadow-[-18px_0_45px_rgba(0,0,0,0.35)] backdrop-blur-xl">
      <div className="flex h-12 items-center justify-between border-b border-white/[0.06] px-4">
        <div>
          <div className="text-[11px] font-semibold text-[#eef5ff]">Node details</div>
          <div className="text-[9px] text-[#66768c]">Edit structure and identity</div>
        </div>
        <button type="button" aria-label="Close inspector" onClick={onClose} className="rounded-md p-1.5 text-[#718198] hover:bg-white/[0.06] hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>
      <div className="flex-1 space-y-3 overflow-y-auto p-4">
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[#617188]">Node type</span>
          <select value={kind} onChange={(event) => setKind(event.target.value as OrgNodeKind)} className="h-8 w-full rounded-lg border border-[#1b3047] bg-[#08131f] px-2.5 text-[11px] text-[#dce6f2] outline-none focus:border-violet-400/70">
            {(Object.keys(KIND_META) as OrgNodeKind[]).map((value) => <option key={value} value={value}>{KIND_META[value].label}</option>)}
          </select>
        </label>
        {field("label", "Name")}
        {field("subtitle", "Role or description")}
        {field("department", "Department")}
        {field("status", "Status")}
        <label className="block">
          <span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[#617188]">Accent</span>
          <div className="flex items-center gap-2 rounded-lg border border-[#1b3047] bg-[#08131f] px-2 py-1.5">
            <input type="color" value={form.accent} onChange={(event) => setForm((value) => ({ ...value, accent: event.target.value }))} className="h-5 w-7 cursor-pointer border-0 bg-transparent" />
            <span className="text-[10px] text-[#91a0b3]">{form.accent}</span>
          </div>
        </label>
      </div>
      <div className="space-y-2 border-t border-white/[0.06] p-4">
        <button type="button" onClick={() => onUpdate(node.id, form, kind)} className="flex h-9 w-full items-center justify-center gap-2 rounded-lg bg-violet-600 text-[11px] font-semibold text-white shadow-[0_0_24px_rgba(124,58,237,0.25)] hover:bg-violet-500">
          <Check className="h-3.5 w-3.5" /> Apply changes
        </button>
        <button type="button" onClick={() => onDelete(node.id)} className="flex h-8 w-full items-center justify-center gap-2 rounded-lg border border-red-500/20 bg-red-500/[0.06] text-[10px] text-red-300 hover:bg-red-500/10">
          <Trash2 className="h-3.5 w-3.5" /> Delete node
        </button>
      </div>
    </aside>
  );
}

export function OrgPage() {
  const [nodes, setNodes, onNodesChange] = useNodesState<OrgNode>(DEFAULT_NODES);
  const [edges, setEdges, onEdgesChange] = useEdgesState<OrgEdge>(DEFAULT_EDGES);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [kindFilter, setKindFilter] = useState<OrgNodeKind | "all">("all");
  const [layoutMode, setLayoutMode] = useState<LayoutMode>("hierarchy");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [historyState, setHistoryState] = useState({ past: 0, future: 0 });
  const pastRef = useRef<Snapshot[]>([]);
  const futureRef = useRef<Snapshot[]>([]);
  const importRef = useRef<HTMLInputElement>(null);
  const flowRef = useRef<ReactFlowInstance<OrgNode, OrgEdge> | null>(null);
  const idRef = useRef(100);

  const remember = useCallback(() => {
    pastRef.current = [...pastRef.current.slice(-29), cloneSnapshot(nodes, edges)];
    futureRef.current = [];
    setHistoryState({ past: pastRef.current.length, future: 0 });
  }, [nodes, edges]);

  useEffect(() => {
    const load = async () => {
      try {
        const response = await fetch("/api/org");
        if (!response.ok) throw new Error("Org API unavailable");
        const data = (await response.json()) as { workspaceId?: string; nodes?: OrgNode[]; edges?: OrgEdge[] };
        if (!data.workspaceId || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) throw new Error("Org API returned an invalid chart");
        setWorkspaceId(data.workspaceId);
        setNodes(data.nodes);
        setEdges(data.edges);
        return;
      } catch {
        const cached = window.localStorage.getItem("sentinel-org-chart");
        if (cached) {
          const data = JSON.parse(cached) as Snapshot;
          if (data.nodes?.length) {
            setNodes(data.nodes);
            setEdges(data.edges ?? []);
          }
        }
      }
    };
    void load();
  }, [setEdges, setNodes]);

  const selectedNode = nodes.find((node) => node.id === selectedId) ?? null;
  const visibleNodes = useMemo<OrgNode[]>(() => {
    const normalized = query.trim().toLowerCase();
    return nodes.map((node) => ({
      ...node,
      hidden:
        (kindFilter !== "all" && node.type !== kindFilter) ||
        Boolean(normalized && !`${node.data.label} ${node.data.subtitle} ${node.data.department}`.toLowerCase().includes(normalized)),
    }));
  }, [kindFilter, nodes, query]);

  const addNode = (kind: OrgNodeKind) => {
    remember();
    const meta = KIND_META[kind];
    const id = `${kind}-${++idRef.current}`;
    setNodes((current) => [
      ...current,
      {
        id,
        type: kind,
        position: { x: 420 + Math.random() * 260, y: 220 + Math.random() * 220 },
        data: {
          label: `New ${meta.label}`,
          subtitle: kind === "agent" ? "AI collaborator" : "Role or function",
          department: "Unassigned",
          status: kind === "agent" ? "Online" : "Active",
          accent: meta.accent,
        },
      },
    ]);
    setSelectedId(id);
  };

  const connect = useCallback((connection: Connection) => {
    remember();
    setEdges((current) => addEdge({
      ...connection,
      type: "smoothstep",
      markerEnd: { type: MarkerType.ArrowClosed, color: "#6aa9df" },
      style: edgeStyle,
    }, current));
  }, [remember, setEdges]);

  const applyLayout = (mode: LayoutMode) => {
    setLayoutMode(mode);
    if (mode === "freeform") return;
    remember();
    setNodes((current) => layoutNodes(current, edges, mode));
    window.setTimeout(() => flowRef.current?.fitView({ padding: 0.16, duration: 550 }), 40);
  };

  const updateNode = (id: string, data: OrgNodeData, kind: OrgNodeKind) => {
    remember();
    setNodes((current) => current.map((node) => node.id === id ? { ...node, type: kind, data } : node));
  };

  const deleteNode = (id: string) => {
    remember();
    setNodes((current) => current.filter((node) => node.id !== id));
    setEdges((current) => current.filter((edge) => edge.source !== id && edge.target !== id));
    setSelectedId(null);
  };

  const undo = () => {
    const previous = pastRef.current.pop();
    if (!previous) return;
    futureRef.current.push(cloneSnapshot(nodes, edges));
    setNodes(previous.nodes);
    setEdges(previous.edges);
    setHistoryState({ past: pastRef.current.length, future: futureRef.current.length });
  };

  const redo = () => {
    const next = futureRef.current.pop();
    if (!next) return;
    pastRef.current.push(cloneSnapshot(nodes, edges));
    setNodes(next.nodes);
    setEdges(next.edges);
    setHistoryState({ past: pastRef.current.length, future: futureRef.current.length });
  };

  const save = async () => {
    if (!workspaceId) {
      setSaveError("No writable workspace is selected. Reload the chart and try again.");
      return;
    }
    setSaving(true);
    setSaved(false);
    setSaveError("");
    const snapshot = cloneSnapshot(nodes, edges);
    try {
      const response = await fetch("/api/org", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ workspaceId, ...snapshot }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? `Save failed with ${response.status}`);
      }
      window.localStorage.setItem(`sentinel-org-chart:${workspaceId}`, JSON.stringify(snapshot));
      setSaved(true);
      window.setTimeout(() => setSaved(false), 1800);
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "Organization changes were not saved.");
    } finally {
      setSaving(false);
    }
  };

  const exportChart = () => {
    const blob = new Blob([JSON.stringify({ nodes, edges }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "sentinel-organization.json";
    link.click();
    URL.revokeObjectURL(url);
  };

  const importChart = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const data = JSON.parse(String(reader.result)) as Snapshot;
        if (!Array.isArray(data.nodes) || !Array.isArray(data.edges)) return;
        remember();
        setNodes(data.nodes);
        setEdges(data.edges);
        window.setTimeout(() => flowRef.current?.fitView({ padding: 0.16, duration: 500 }), 50);
      } finally {
        event.target.value = "";
      }
    };
    reader.readAsText(file);
  };

  return (
    <div className="relative flex h-full min-h-[620px] w-full flex-col overflow-hidden bg-[#020812] text-[#e8f0fa]">
      <div className="relative z-40 flex min-h-12 shrink-0 flex-wrap items-center gap-2 border-b border-[#172c42] bg-[#06101b]/98 px-3 py-2">
        <div className="mr-1 flex items-center gap-2 border-r border-white/[0.065] pr-3">
          <Network className="h-4 w-4 text-violet-300" />
          <div>
            <div className="text-[11px] font-semibold">Organization</div>
            <div className="text-[8.5px] text-[#62738a]">Neural command structure</div>
          </div>
        </div>

        <div className="flex items-center gap-1">
          <ToolbarButton label="Hierarchy layout" active={layoutMode === "hierarchy"} onClick={() => applyLayout("hierarchy")}><GitBranch className="h-3.5 w-3.5" /> Hierarchy</ToolbarButton>
          <ToolbarButton label="Radial layout" active={layoutMode === "radial"} onClick={() => applyLayout("radial")}><CircleDot className="h-3.5 w-3.5" /> Radial</ToolbarButton>
          <ToolbarButton label="Freeform layout" active={layoutMode === "freeform"} onClick={() => applyLayout("freeform")}><Grid3X3 className="h-3.5 w-3.5" /> Freeform</ToolbarButton>
        </div>

        <label className="relative ml-1 min-w-[150px] flex-1 sm:max-w-[240px]">
          <Search className="pointer-events-none absolute left-2.5 top-2 h-3.5 w-3.5 text-[#607086]" />
          <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search organization…" className="h-8 w-full rounded-lg border border-[#1b3047] bg-[#08131f] pl-8 pr-2 text-[10px] text-[#dce6f2] outline-none placeholder:text-[#56667a] focus:border-violet-400/60" />
        </label>

        <div className="flex items-center gap-1">
          <ToolbarButton label="Undo" onClick={undo} disabled={historyState.past === 0}><Undo2 className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton label="Redo" onClick={redo} disabled={historyState.future === 0}><Redo2 className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton label="Fit chart" onClick={() => flowRef.current?.fitView({ padding: 0.16, duration: 450 })}><LayoutDashboard className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton label="Import chart" onClick={() => importRef.current?.click()}><Upload className="h-3.5 w-3.5" /></ToolbarButton>
          <ToolbarButton label="Export chart" onClick={exportChart}><Download className="h-3.5 w-3.5" /></ToolbarButton>
          <input ref={importRef} type="file" accept="application/json" className="hidden" onChange={importChart} />
        </div>

        {saveError ? <span role="alert" className="ml-auto max-w-64 truncate text-[9px] text-red-300" title={saveError}>{saveError}</span> : null}
        <button type="button" onClick={save} disabled={saving || !workspaceId} className={`${saveError ? "" : "ml-auto"} flex h-8 items-center gap-1.5 rounded-lg bg-violet-600 px-3 text-[10px] font-semibold text-white shadow-[0_0_24px_rgba(124,58,237,0.26)] hover:bg-violet-500 disabled:opacity-60`}>
          {saved ? <Check className="h-3.5 w-3.5" /> : <Save className="h-3.5 w-3.5" />}
          {saving ? "Saving…" : saved ? "Saved" : "Save changes"}
        </button>
      </div>

      <div className="relative min-h-0 flex-1">
        <ReactFlow
          nodes={visibleNodes}
          edges={edges}
          nodeTypes={nodeTypes}
          onInit={(instance) => { flowRef.current = instance; }}
          onNodesChange={onNodesChange}
          onEdgesChange={onEdgesChange}
          onConnect={connect}
          onNodeClick={(_, node) => setSelectedId(node.id)}
          onNodeDragStart={remember}
          onPaneClick={() => setSelectedId(null)}
          onEdgeClick={(_, edge) => {
            remember();
            setEdges((current) => current.filter((item) => item.id !== edge.id));
          }}
          fitView
          fitViewOptions={{ padding: 0.16 }}
          minZoom={0.24}
          maxZoom={1.8}
          snapToGrid
          snapGrid={[16, 16]}
          defaultEdgeOptions={{ type: "smoothstep", style: edgeStyle }}
          className="org-neural-canvas"
          colorMode="dark"
          proOptions={{ hideAttribution: true }}
        >
          <Background variant={BackgroundVariant.Dots} color="#18324a" gap={22} size={1} />
          <Controls position="bottom-left" showInteractive={false} className="!border-[#1b3047] !bg-[#07131f] !shadow-xl [&>button]:!border-[#1b3047] [&>button]:!bg-[#07131f] [&>button]:!fill-[#8da0b8] [&>button:hover]:!bg-[#102238]" />
          <MiniMap position="bottom-left" pannable zoomable nodeColor={(node) => (node.data as OrgNodeData).accent || "#8b5cf6"} maskColor="rgba(2,8,18,0.72)" className="!mb-12 !border !border-[#1b3047] !bg-[#06101b]" />

          <Panel position="top-left" className="!m-3">
            <div className="flex flex-wrap items-center gap-1.5 rounded-xl border border-[#19324a] bg-[#06111d]/94 p-1.5 shadow-2xl backdrop-blur-xl">
              {(Object.keys(KIND_META) as OrgNodeKind[]).map((kind) => {
                const meta = KIND_META[kind];
                const Icon = meta.icon;
                return <button key={kind} type="button" onClick={() => addNode(kind)} className="flex h-8 items-center gap-1.5 rounded-lg border border-transparent px-2.5 text-[9.5px] text-[#9cacbf] hover:border-white/[0.08] hover:bg-white/[0.05] hover:text-white"><Icon className="h-3.5 w-3.5" style={{ color: meta.accent }} /> {meta.label}</button>;
              })}
            </div>
          </Panel>

          <Panel position="top-right" className={cn("!m-3", selectedNode && "!mr-[306px]")}>
            <div className="flex items-center gap-1 rounded-xl border border-[#19324a] bg-[#06111d]/94 p-1 shadow-xl backdrop-blur-xl">
              <button type="button" onClick={() => setKindFilter("all")} className={cn("h-7 rounded-lg px-2.5 text-[9px]", kindFilter === "all" ? "bg-violet-500/20 text-violet-200" : "text-[#718198] hover:text-white")}>All</button>
              {(Object.keys(KIND_META) as OrgNodeKind[]).map((kind) => <button key={kind} type="button" aria-label={`Filter ${KIND_META[kind].label}`} onClick={() => setKindFilter(kindFilter === kind ? "all" : kind)} className={cn("flex h-7 w-7 items-center justify-center rounded-lg", kindFilter === kind ? "bg-violet-500/20 text-violet-200" : "text-[#718198] hover:bg-white/[0.05] hover:text-white")}>{(() => { const Icon = KIND_META[kind].icon; return <Icon className="h-3.5 w-3.5" />; })()}</button>)}
            </div>
          </Panel>

          <Panel position="bottom-center" className="!mb-3">
            <div className="flex items-center gap-4 rounded-full border border-[#18334c] bg-[#06111d]/94 px-4 py-2 text-[9px] text-[#74859b] shadow-xl backdrop-blur-xl">
              <span className="flex items-center gap-1.5"><span className="h-1.5 w-1.5 rounded-full bg-emerald-400 shadow-[0_0_8px_#34d399]" /> Auto-save ready</span>
              <span>{nodes.length} nodes</span>
              <span>{edges.length} connections</span>
              <span>{selectedNode ? "1 selected" : "No selection"}</span>
            </div>
          </Panel>
        </ReactFlow>

        {selectedNode ? <Inspector key={selectedNode.id} node={selectedNode} onUpdate={updateNode} onDelete={deleteNode} onClose={() => setSelectedId(null)} /> : null}
      </div>
    </div>
  );
}
