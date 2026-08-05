"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useGraphStore } from "@/store/useGraphStore";
import { NeuralLensGraph } from "./NeuralLensGraph";
import { NeuralLensPanel } from "./NeuralLensPanel";
import { NeuralLensToolbar } from "./NeuralLensToolbar";
import { NeuralLensStatusBar } from "./NeuralLensStatusBar";
import { NeuralLensInspector } from "./NeuralLensInspector";
import { NeuralLensMinimap } from "./NeuralLensMinimap";
import { NeuralLensContextMenu, type ContextMenuTarget } from "./NeuralLensContextMenu";
import { TimelineScrubber, type TimeRange } from "./TimelineScrubber";
import { generateDemoGraph } from "./demoGraph";
import { buildLensGraphFromApi } from "./fromApiGraph";
import { useNeuralStream } from "./useNeuralStream";
import { routeForCluster } from "./categories";
import type { LensGraph, LensNode } from "./types";

const ACTIVE_PULSE_MS = 2600;

/** Range -> how far back "at" reaches. "Today" means local midnight, not a rolling 24h. */
function timestampForRange(range: TimeRange): Date {
  const now = new Date();
  switch (range) {
    case "1h":
      return new Date(now.getTime() - 60 * 60 * 1000);
    case "Today":
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case "Week":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "Month":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "Now":
    default:
      return now;
  }
}

export function NeuralLens({ projectId }: { projectId?: string } = {}) {
  const [demoMode, setDemoMode] = useState(true);
  const [demoGraph] = useState<LensGraph>(() => generateDemoGraph());
  const [scopedGraph, setScopedGraph] = useState<LensGraph | null>(null);
  // Search, type filters, the selected node, the lens, and view state
  // (camera/zoom) are shared via useGraphStore rather than kept as local
  // state — RightPanel's compact Graph tab reads the same selection/filter
  // state the canvas does, and camera/lens/selection persist across reloads.
  const activeTypes = useGraphStore((state) => state.activeTypes);
  const toggleGraphType = useGraphStore((state) => state.toggleType);
  const search = useGraphStore((state) => state.search);
  const setSearch = useGraphStore((state) => state.setSearch);
  const selected = useGraphStore((state) => state.selectedNode);
  const setSelectedNode = useGraphStore((state) => state.setSelectedNode);
  const setAvailableTypes = useGraphStore((state) => state.setAvailableTypes);
  const lensClusterId = useGraphStore((state) => state.lensClusterId);
  const setLensCluster = useGraphStore((state) => state.setLensCluster);
  const lensOnly = useGraphStore((state) => state.lensOnly);
  const setLensOnly = useGraphStore((state) => state.setLensOnly);
  const zoomLevel = useGraphStore((state) => state.zoomLevel);
  const setZoomLevel = useGraphStore((state) => state.setZoomLevel);
  const cameraState = useGraphStore((state) => state.cameraState);
  const setCameraState = useGraphStore((state) => state.setCameraState);
  // Title-based focus requests (e.g. switching the active chat agent) —
  // resolved against the full graph, not just what's currently filtered in,
  // so focusing an agent works even mid-search/mid-filter.
  const focusRequestTitle = useGraphStore((state) => state.focusRequest);
  const requestFocus = useGraphStore((state) => state.requestFocus);
  // Every agent currently selected into the active chat — their nodes stay
  // lit continuously, independent of hover/click focus or live-event pulses.
  const pinnedTitles = useGraphStore((state) => state.pinnedTitles);
  const [toolbarAction, setToolbarAction] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("Now");
  const [historicalGraph, setHistoricalGraph] = useState<LensGraph | null>(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [activeNodeIds, setActiveNodeIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const router = useRouter();
  const isHistorical = !demoMode && timeRange !== "Now";

  const handleOpenModule = useCallback(
    (node: LensNode) => {
      router.push(routeForCluster(node.clusterId));
    },
    [router],
  );

  // Reconstruct historical state via temporal-service (Phase E) — only
  // meaningful in SCOPED mode, since the demo graph carries no real
  // validFrom/validTo history to reconstruct.
  useEffect(() => {
    // Nothing to fetch when live or in demo mode — baseGraph's isHistorical
    // check already ignores a stale historicalGraph in that case, so there's
    // no state to reset here (only synchronous work belongs directly in an
    // effect body; everything else happens inside the async callback below).
    if (demoMode || timeRange === "Now") return;

    let cancelled = false;
    void (async () => {
      setHistoricalLoading(true);
      try {
        const at = timestampForRange(timeRange).toISOString();
        const query = new URLSearchParams({ at });
        if (projectId) query.set("projectId", projectId);
        const res = await fetch(`/api/neural/temporal?${query.toString()}`);
        if (!res.ok) return;
        const data = (await res.json()) as { nodes: { id: string; type: string; title: string }[]; edges: { fromObjectId: string; toObjectId: string; weight?: number }[] };
        if (!cancelled) setHistoricalGraph(buildLensGraphFromApi(data));
      } catch {
        /* keep whatever was showing before */
      } finally {
        if (!cancelled) setHistoricalLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demoMode, timeRange, projectId]);

  const { connected, events, lastEventAt } = useNeuralStream({ projectId, enabled: true });
  const pulseTimers = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());

  // Fetch real graph when SCOPED is selected.
  useEffect(() => {
    if (demoMode || scopedGraph) return;
    let cancelled = false;
    void (async () => {
      try {
        const query = projectId ? `?projectId=${encodeURIComponent(projectId)}` : "";
        const res = await fetch(`/api/graph${query}`);
        if (!res.ok) return;
        const data = (await res.json()) as { nodes: { id: string; type: string; title: string }[]; edges: { fromObjectId: string; toObjectId: string; weight?: number }[] };
        if (!cancelled) setScopedGraph(buildLensGraphFromApi(data));
      } catch {
        /* keep demo fallback */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [demoMode, scopedGraph, projectId]);

  const baseGraph = isHistorical
    ? historicalGraph ?? scopedGraph ?? demoGraph
    : demoMode
      ? demoGraph
      : scopedGraph ?? demoGraph;

  // Pulse nodes touched by live events. Suppressed while viewing historical
  // state — a past snapshot shouldn't animate as if it were live right now.
  // If a payload id matches a node, pulse it; otherwise (DEMO ids won't match
  // real event ids) pulse a deterministic node derived from the event id so
  // liveness is visible and honest.
  useEffect(() => {
    if (isHistorical) return;
    if (events.length === 0) return;
    const latest = events[0];
    const payloadIds = new Set(
      JSON.stringify(latest.payload ?? {})
        .match(/[a-z0-9]{16,}/gi)
        ?.slice(0, 4) ?? [],
    );
    let matched = baseGraph.nodes.filter((n) => payloadIds.has(n.id)).map((n) => n.id);
    if (matched.length === 0 && baseGraph.nodes.length > 0) {
      const idx = Math.abs(hashStr(latest.id)) % baseGraph.nodes.length;
      matched = [baseGraph.nodes[idx].id, baseGraph.nodes[(idx + 7) % baseGraph.nodes.length].id];
    }
    setActiveNodeIds((prev) => {
      const next = new Set(prev);
      for (const id of matched) {
        next.add(id);
        const existing = pulseTimers.current.get(id);
        if (existing) clearTimeout(existing);
        pulseTimers.current.set(
          id,
          setTimeout(() => {
            setActiveNodeIds((s) => {
              const n2 = new Set(s);
              n2.delete(id);
              return n2;
            });
            pulseTimers.current.delete(id);
          }, ACTIVE_PULSE_MS),
        );
      }
      return next;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastEventAt]);

  useEffect(() => {
    const timers = pulseTimers.current;
    return () => {
      for (const t of timers.values()) clearTimeout(t);
      timers.clear();
    };
  }, []);

  // Resolve pinned titles (selected chat agents) to node ids — same
  // case-insensitive substring match the search box and focus resolution
  // both already use — then union into the pulsing/lit set below.
  const pinnedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const title of pinnedTitles) {
      const q = title.trim().toLowerCase();
      if (!q) continue;
      const node = baseGraph.nodes.find((n) => n.label.toLowerCase().includes(q));
      if (node) ids.add(node.id);
    }
    return ids;
  }, [pinnedTitles, baseGraph.nodes]);

  const litNodeIds = useMemo(
    () => new Set([...activeNodeIds, ...pinnedNodeIds]),
    [activeNodeIds, pinnedNodeIds]
  );

  // Search + type-chip filtering — an explicit user action, distinct from
  // the lens (which dims rather than removes; see NeuralLensGraph's
  // lensClusterId/lensOnly props). Default (no active chips, no search)
  // shows the whole constellation.
  const filteredGraph = useMemo<LensGraph>(() => {
    const q = search.trim().toLowerCase();

    const nodes = baseGraph.nodes.filter((n) => {
      const typeOk = n.val >= 6 || activeTypes.size === 0 || activeTypes.has(n.type); // always keep hubs
      const searchOk = q === "" || n.label.toLowerCase().includes(q);
      return typeOk && searchOk;
    });
    const keep = new Set(nodes.map((n) => n.id));
    const links = baseGraph.links.filter((l) => keep.has(l.source) && keep.has(l.target));
    return { nodes, links, meta: { ...baseGraph.meta, nodeCount: nodes.length, edgeCount: links.length }, clusterOutlines: baseGraph.clusterOutlines };
  }, [baseGraph, activeTypes, search]);

  const typeChips = useMemo(() => {
    const set = new Set<string>();
    for (const n of baseGraph.nodes) if (n.val < 6) set.add(n.type);
    return [...set].sort();
  }, [baseGraph.nodes]);

  // Share the available type chips with any other UI filtering the same
  // graph (RightPanel's Graph tab) — recomputed whenever the underlying
  // graph's own type set changes (demo/scoped swap, live data arriving).
  useEffect(() => {
    setAvailableTypes(typeChips);
  }, [typeChips, setAvailableTypes]);

  const handleToggleType = useCallback(
    (type: string) => {
      toggleGraphType(type);
    },
    [toggleGraphType]
  );

  const handleSelect = useCallback(
    (node: LensNode | null) => {
      setSelectedNode(
        node
          ? {
              id: node.id,
              label: node.label,
              type: node.type,
              val: node.val,
              hubId: node.hubId,
              clusterId: node.clusterId,
              accent: node.accent,
              active: node.active,
            }
          : null
      );
    },
    [setSelectedNode]
  );

  const handleToolbarAction = useCallback((id: string) => {
    setToolbarAction((prev) => (prev === id ? null : id));
    if (id === "time") setTimelineOpen((v) => !v);
  }, []);

  // Resolve a title-based focus request (agent switch, chat reference) to a
  // concrete node id in the current graph. Case-insensitive substring match,
  // same convention the search box already uses. Silently no-ops if nothing
  // matches (e.g. the agent has no corresponding graph node yet) rather than
  // erroring — consistent with the rest of this component's degrade-quietly style.
  const resolvedFocusRequest = useMemo(() => {
    if (!focusRequestTitle) return null;
    const q = focusRequestTitle.title.trim().toLowerCase();
    if (!q) return null;
    const node = baseGraph.nodes.find((n) => n.label.toLowerCase().includes(q));
    return node ? { nodeId: node.id, ts: focusRequestTitle.ts } : null;
  }, [focusRequestTitle, baseGraph.nodes]);

  // A handful of the selected node's direct neighbors — "connected entities"
  // in the detail drawer. Capped so a 5,000-edge hub doesn't dump its entire
  // fan into a sidebar.
  const connectedEntities = useMemo(() => {
    if (!selected) return [];
    const nodesById = new Map(baseGraph.nodes.map((n) => [n.id, n]));
    const neighborIds = new Set<string>();
    for (const link of baseGraph.links) {
      if (link.source === selected.id) neighborIds.add(link.target);
      else if (link.target === selected.id) neighborIds.add(link.source);
      if (neighborIds.size >= 8) break;
    }
    return [...neighborIds]
      .map((id) => nodesById.get(id))
      .filter((n): n is NonNullable<typeof n> => !!n)
      .slice(0, 6);
  }, [selected, baseGraph.nodes, baseGraph.links]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#010409]">
      <NeuralLensGraph
        graph={filteredGraph}
        activeNodeIds={litNodeIds}
        onSelect={handleSelect}
        onZoomLevel={setZoomLevel}
        focusRequest={resolvedFocusRequest}
        lensClusterId={lensClusterId}
        lensOnly={lensOnly}
        initialCamera={cameraState}
        onCameraChange={setCameraState}
        onDoubleClickNode={handleOpenModule}
        onContextMenuNode={(node, screen) => setContextMenu({ node, x: screen.x, y: screen.y })}
      />

      <NeuralLensContextMenu
        target={contextMenu}
        onClose={() => setContextMenu(null)}
        onFocus={(node) => requestFocus(node.label)}
        onOpenModule={handleOpenModule}
      />

      <NeuralLensPanel
        lensClusterId={lensClusterId}
        onLensChange={setLensCluster}
        lensOnly={lensOnly}
        onLensOnlyChange={setLensOnly}
        workingSetName={demoMode ? "Mission Control" : "Live Graph"}
        nodeCount={filteredGraph.meta.nodeCount}
        edgeCount={filteredGraph.meta.edgeCount}
        typeChips={typeChips}
        activeTypes={activeTypes}
        onToggleType={handleToggleType}
        search={search}
        onSearchChange={setSearch}
        demoMode={demoMode}
        onToggleDemoMode={setDemoMode}
      />

      <NeuralLensToolbar active={toolbarAction} onAction={handleToolbarAction} />
      <NeuralLensMinimap graph={baseGraph} />
      <NeuralLensInspector
        node={selected}
        connected={connectedEntities}
        onClose={() => setSelectedNode(null)}
        onFocusConnected={(label) => requestFocus(label)}
        onOpenModule={() => selected?.clusterId && router.push(routeForCluster(selected.clusterId))}
      />
      <TimelineScrubber
        open={timelineOpen}
        range={timeRange}
        onRangeChange={setTimeRange}
        onClose={() => {
          setTimelineOpen(false);
          setToolbarAction(null);
          setTimeRange("Now");
        }}
        demoMode={demoMode}
        loading={historicalLoading}
        asOf={isHistorical ? timestampForRange(timeRange) : null}
      />

      {/* Interaction hint only; the production module bar owns live status. */}
      <div className="pointer-events-none absolute bottom-12 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-2 rounded-full border border-white/[0.06] bg-[#050813]/70 px-3 py-1.5 text-[8px] uppercase tracking-[0.18em] text-white/30 backdrop-blur-xl lg:flex">
        <span>Drag to rotate</span>
        <span className="h-1 w-1 rounded-full bg-cyan-300/50" />
        <span>Scroll to dive</span>
        <span className="h-1 w-1 rounded-full bg-fuchsia-300/50" />
        <span>Click a node to focus</span>
      </div>

      <NeuralLensStatusBar
        connected={connected}
        nodeCount={filteredGraph.meta.nodeCount}
        edgeCount={filteredGraph.meta.edgeCount}
        zoomLevel={zoomLevel}
        asOf={isHistorical ? timestampForRange(timeRange) : null}
      />
    </div>
  );
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
