"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { Clock } from "lucide-react";
import { useGraphStore, type RecentTrace } from "@/store/useGraphStore";
import { NeuralLensGraph, type GlobeGraphApi } from "./NeuralLensGraph";
import { GraphControlRail } from "./GraphControlRail";
import { GraphContextRail } from "./GraphContextRail";
import { NeuralLensContextMenu, type ContextMenuTarget } from "./NeuralLensContextMenu";
import { TimelineScrubber, type TimeRange } from "./TimelineScrubber";
import { generateDemoGraph } from "./demoGraph";
import { buildLensGraphFromApi } from "./fromApiGraph";
import { useNeuralStream } from "./useNeuralStream";
import { CLUSTER_IDS, CORE_CLUSTER_ID, routeForCluster, type ClusterId } from "./categories";
import type { GlobeScene } from "./globe/GlobeScene";
import type { ExecutionPath, LensGraph, LensNode } from "./types";

const ACTIVE_PULSE_MS = 2600;
const SEARCH_FOCUS_DEBOUNCE_MS = 320;
const DEMO_TRACE_COUNT = 3;

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

/**
 * The route the active-path pulse traverses.
 *
 * With live data, the route is the chain of nodes recent events actually
 * touched. With DEMO data there are no real events to chain, so the route is
 * the canonical spine of the OS — the agent core out through workflows, code,
 * memory, projects and infrastructure. That's illustrative, which is exactly
 * what the DEMO badge on this surface is there to say.
 */
function buildActivityPath(graph: LensGraph, litIds: Set<string>, demo: boolean): ExecutionPath | null {
  if (litIds.size >= 2) {
    const ordered = graph.nodes.filter((node) => litIds.has(node.id)).map((node) => node.id);
    if (ordered.length >= 2) {
      return { id: `live:${ordered[0]}`, nodeIds: ordered.slice(0, 6), startedAt: Date.now() };
    }
  }
  if (!demo) return null;

  const spine: ClusterId[] = [CORE_CLUSTER_ID, "Learning", "Coding", "Memory", "Projects", "Infrastructure"];
  const byCluster = new Map<ClusterId, string>();
  for (const node of graph.nodes) {
    if (!node.isHub || node.val < 6) continue;
    if (!byCluster.has(node.clusterId)) byCluster.set(node.clusterId, node.id);
  }
  const nodeIds = spine.map((cluster) => byCluster.get(cluster)).filter((id): id is string => !!id);
  return nodeIds.length >= 2 ? { id: "demo:spine", nodeIds, startedAt: 0 } : null;
}

/** Honest, illustrative replay history for the graph's explicitly-labelled
 * DEMO mode. Every sample is a walk along the same canonical spine used by
 * buildActivityPath, so replay never invents a second graph route. */
function buildDemoTraces(graph: LensGraph): RecentTrace[] {
  const path = buildActivityPath(graph, new Set(), true);
  if (!path) return [];

  const labels = new Map(graph.nodes.map((node) => [node.id, node.label]));
  const routes = [
    path.nodeIds,
    path.nodeIds.slice(0, 4),
    path.nodeIds.slice(-4),
  ];
  const now = Date.now();
  const seen = new Set<string>();

  return routes
    .filter((nodeIds) => {
      const key = nodeIds.join("\u0000");
      if (nodeIds.length < 2 || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, DEMO_TRACE_COUNT)
    .map((nodeIds, index) => ({
      id: `demo:trace:${index + 1}`,
      label: `DEMO · ${nodeIds.map((id) => labels.get(id) ?? id).join(" → ")}`,
      nodeIds,
      capturedAt: now - (index + 1) * 75_000,
    }));
}

const EMPTY_HIGHLIGHT_TITLES: string[] = [];

export function NeuralLens({
  projectId,
  apiRef: externalApiRef,
  highlightTitles = EMPTY_HIGHLIGHT_TITLES,
}: {
  projectId?: string;
  apiRef?: RefObject<GlobeGraphApi | null>;
  /** Additive collaboration focus: these agent/task/file labels stay lit. */
  highlightTitles?: string[];
} = {}) {
  const [demoMode, setDemoMode] = useState(true);
  const [demoGraph] = useState<LensGraph>(() => generateDemoGraph());
  const [scopedGraph, setScopedGraph] = useState<LensGraph | null>(null);
  // Search, type filters, the selected node, the lens, render settings, and
  // view state (camera/zoom) are shared via useGraphStore rather than kept as
  // local state — RightPanel's compact Graph tab reads the same
  // selection/filter state the canvas does, and camera/lens/settings persist
  // across reloads.
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
  const graphSettings = useGraphStore((state) => state.graphSettings);
  const setGraphSettings = useGraphStore((state) => state.setGraphSettings);
  const fitRequest = useGraphStore((state) => state.fitRequest);
  const requestFit = useGraphStore((state) => state.requestFit);
  const followLive = useGraphStore((state) => state.followLive);
  const setFollowLive = useGraphStore((state) => state.setFollowLive);
  const addRecentTrace = useGraphStore((state) => state.addRecentTrace);
  const seedRecentTraces = useGraphStore((state) => state.seedRecentTraces);
  const activeTrace = useGraphStore((state) => state.activeTrace);
  const traceStepIndex = useGraphStore((state) => state.traceStepIndex);
  // Title-based focus requests (e.g. switching the active chat agent) —
  // resolved against the full graph, not just what's currently filtered in,
  // so focusing an agent works even mid-search/mid-filter.
  const focusRequestTitle = useGraphStore((state) => state.focusRequest);
  const requestFocus = useGraphStore((state) => state.requestFocus);
  // Every agent currently selected into the active chat — their nodes stay
  // lit continuously, independent of hover/click focus or live-event pulses.
  const pinnedTitles = useGraphStore((state) => state.pinnedTitles);

  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("Now");
  const [historicalGraph, setHistoricalGraph] = useState<LensGraph | null>(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [activeNodeIds, setActiveNodeIds] = useState<Set<string>>(new Set());
  const [contextMenu, setContextMenu] = useState<ContextMenuTarget | null>(null);
  const [scene, setScene] = useState<GlobeScene | null>(null);
  // A caller (LensOverview) can hand in its own ref to drive the camera
  // (e.g. focusRegion on entry) without this component forking into two
  // implementations — falls back to an internal ref when embedded standalone.
  const internalApiRef = useRef<GlobeGraphApi | null>(null);
  const graphApi = externalApiRef ?? internalApiRef;
  const router = useRouter();
  const isHistorical = !demoMode && timeRange !== "Now";

  const handleOpenModule = useCallback(
    (node: LensNode | { clusterId?: ClusterId }) => {
      if (node.clusterId) router.push(routeForCluster(node.clusterId));
    },
    [router],
  );

  // Reconstruct historical state via temporal-service — only meaningful in
  // SCOPED mode, since the demo graph carries no real validFrom/validTo
  // history to reconstruct.
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
        const data = (await res.json()) as { nodes: { id: string; type: string; title: string }[]; edges: { fromObjectId: string; toObjectId: string; weight?: number; type?: string }[] };
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
        const data = (await res.json()) as { nodes: { id: string; type: string; title: string }[]; edges: { fromObjectId: string; toObjectId: string; weight?: number; type?: string }[] };
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

  useEffect(() => {
    if (!demoMode) return;
    seedRecentTraces(buildDemoTraces(demoGraph));
  }, [demoMode, demoGraph, seedRecentTraces]);

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
    const realMatches = baseGraph.nodes.filter((node) => payloadIds.has(node.id));
    let matched = realMatches.map((node) => node.id);
    if (realMatches.length >= 2) {
      const capturedAt = Date.parse(latest.createdAt);
      addRecentTrace({
        id: `live:${latest.id}`,
        label: realMatches.map((node) => node.label).join(" → "),
        nodeIds: matched,
        capturedAt: Number.isNaN(capturedAt) ? lastEventAt ?? Date.now() : capturedAt,
      });
    }
    if (matched.length === 0 && baseGraph.nodes.length > 0) {
      const idx = Math.abs(hashStr(latest.id)) % baseGraph.nodes.length;
      matched = [baseGraph.nodes[idx].id, baseGraph.nodes[(idx + 7) % baseGraph.nodes.length].id];
    }
    // Follow Live (default off): camera moves to the node the newest event
    // touched. Off by default — the graph never spins the operator's camera
    // on its own; this only fires once the operator has opted in.
    if (followLive && matched.length > 0) graphApi.current?.focusNode(matched[0]);
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

  // Resolve pinned titles (selected chat agents) and collaboration-event
  // highlights to node ids — same
  // case-insensitive substring match the search box and focus resolution
  // both already use — then union into the pulsing/lit set below.
  const pinnedNodeIds = useMemo(() => {
    const ids = new Set<string>();
    for (const title of [...pinnedTitles, ...highlightTitles]) {
      const q = title.trim().toLowerCase();
      if (!q) continue;
      const node = baseGraph.nodes.find((n) => n.label.toLowerCase().includes(q));
      if (node) ids.add(node.id);
    }
    return ids;
  }, [pinnedTitles, highlightTitles, baseGraph.nodes]);

  const litNodeIds = useMemo(
    () => new Set([...activeNodeIds, ...pinnedNodeIds]),
    [activeNodeIds, pinnedNodeIds],
  );

  // Type-chip filtering is the one control that removes nodes from the canvas
  // (the lens dims rather than removes; search focuses rather than filters).
  // Hubs always survive so a filtered graph still reads as the same planet.
  const filteredGraph = useMemo<LensGraph>(() => {
    if (activeTypes.size === 0) return baseGraph;
    // A trace being replayed must stay renderable even if its nodes' types
    // aren't in the active type filter — otherwise selecting a trace advances
    // the step counter while GlobeScene has nothing to draw a route through
    // (its nodes were filtered out of the graph passed to it, not just dimmed).
    const forcedIds = activeTrace ? new Set(activeTrace.nodeIds) : null;
    const nodes = baseGraph.nodes.filter((n) => n.isHub || activeTypes.has(n.type) || forcedIds?.has(n.id));
    const keep = new Set(nodes.map((n) => n.id));
    const links = baseGraph.links.filter((l) => keep.has(l.source) && keep.has(l.target));
    return {
      nodes,
      links,
      meta: { ...baseGraph.meta, nodeCount: nodes.length, edgeCount: links.length },
      regions: baseGraph.regions,
    };
  }, [baseGraph, activeTypes, activeTrace]);

  const typeChips = useMemo(() => {
    const set = new Set<string>();
    for (const n of baseGraph.nodes) if (!n.isHub) set.add(n.type);
    return [...set].sort();
  }, [baseGraph.nodes]);

  const layerCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const cluster of CLUSTER_IDS) counts.set(cluster, 0);
    for (const node of filteredGraph.nodes) {
      counts.set(node.clusterId, (counts.get(node.clusterId) ?? 0) + 1);
    }
    return counts;
  }, [filteredGraph.nodes]);

  // Share the available type chips with any other UI filtering the same
  // graph (RightPanel's Graph tab) — recomputed whenever the underlying
  // graph's own type set changes (demo/scoped swap, live data arriving).
  useEffect(() => {
    setAvailableTypes(typeChips);
  }, [typeChips, setAvailableTypes]);

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
          : null,
      );
    },
    [setSelectedNode],
  );

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

  // Search focuses rather than filters: the graph is one stable planet, so
  // finding something means the camera goes there, not that everything else
  // disappears.
  useEffect(() => {
    const query = search.trim().toLowerCase();
    if (!query) return;
    const timer = setTimeout(() => {
      const match =
        filteredGraph.nodes.find((node) => node.label.toLowerCase() === query) ??
        filteredGraph.nodes.find((node) => node.label.toLowerCase().includes(query));
      if (!match) return;
      handleSelect(match);
      graphApi.current?.focusNode(match.id);
    }, SEARCH_FOCUS_DEBOUNCE_MS);
    return () => clearTimeout(timer);
  }, [search, filteredGraph.nodes, handleSelect]);

  // A handful of the selected node's direct neighbors — "connected entities"
  // in the detail panel, each carrying the relationship type off its edge so
  // the panel can say *how* it connects, not just that it does. Capped so a
  // 5,000-edge hub doesn't dump its entire fan into a sidebar.
  const connectedEntities = useMemo(() => {
    if (!selected) return [];
    const nodesById = new Map(baseGraph.nodes.map((n) => [n.id, n]));
    const relationshipOf = new Map<string, string | undefined>();
    for (const link of baseGraph.links) {
      if (link.source === selected.id) relationshipOf.set(link.target, link.type);
      else if (link.target === selected.id) relationshipOf.set(link.source, link.type);
      if (relationshipOf.size >= 8) break;
    }
    return [...relationshipOf.entries()]
      .map(([id, relationship]) => {
        const node = nodesById.get(id);
        return node ? { ...node, relationship } : null;
      })
      .filter((n): n is NonNullable<typeof n> => !!n)
      .slice(0, 6);
  }, [selected, baseGraph.nodes, baseGraph.links]);

  const liveExecutionPath = useMemo(
    () => buildActivityPath(filteredGraph, litNodeIds, demoMode),
    [filteredGraph, litNodeIds, demoMode],
  );
  const executionPath = useMemo<ExecutionPath | null>(() => {
    if (!activeTrace) return liveExecutionPath;
    return {
      id: activeTrace.id,
      nodeIds: activeTrace.nodeIds.slice(0, traceStepIndex + 1),
      startedAt: activeTrace.capturedAt,
    };
  }, [activeTrace, traceStepIndex, liveExecutionPath]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#01040a]">
      <NeuralLensGraph
        graph={filteredGraph}
        activeNodeIds={litNodeIds}
        dimUnrelatedActive={highlightTitles.length > 0}
        selectedId={selected?.id ?? null}
        onSelect={handleSelect}
        onZoomLevel={setZoomLevel}
        focusRequest={resolvedFocusRequest}
        lensClusterId={lensClusterId}
        lensOnly={lensOnly}
        executionPath={executionPath}
        settings={graphSettings}
        resetSignal={fitRequest}
        initialCamera={cameraState}
        onCameraChange={setCameraState}
        onDoubleClickNode={handleOpenModule}
        onContextMenuNode={(node, screenPosition) =>
          setContextMenu({ node, x: screenPosition.x, y: screenPosition.y })
        }
        onLensChange={setLensCluster}
        onSceneReady={setScene}
        apiRef={graphApi}
      />

      <NeuralLensContextMenu
        target={contextMenu}
        onClose={() => setContextMenu(null)}
        onFocus={(node) => requestFocus(node.label)}
        onOpenModule={handleOpenModule}
      />

      <GraphControlRail
        lensClusterId={lensClusterId}
        onLensChange={setLensCluster}
        lensOnly={lensOnly}
        onLensOnlyChange={setLensOnly}
        settings={graphSettings}
        onSettingsChange={setGraphSettings}
        search={search}
        onSearchChange={setSearch}
        typeChips={typeChips}
        activeTypes={activeTypes}
        onToggleType={toggleGraphType}
        demoMode={demoMode}
        onToggleDemoMode={setDemoMode}
        layerCounts={layerCounts}
        timelineOpen={timelineOpen}
        onToggleTimeline={() => setTimelineOpen((open) => !open)}
        followLive={followLive}
        onFollowLiveChange={setFollowLive}
      />

      <GraphContextRail
        graph={filteredGraph}
        scene={scene}
        nodeCount={filteredGraph.meta.nodeCount}
        edgeCount={filteredGraph.meta.edgeCount}
        connected={connected}
        events={events}
        lensClusterId={lensClusterId}
        lensOnly={lensOnly}
        onLensChange={setLensCluster}
        selected={selected}
        connectedEntities={connectedEntities}
        onClearSelection={() => setSelectedNode(null)}
        onFocusEntity={(label) => requestFocus(label)}
        onOpenModule={() => selected?.clusterId && router.push(routeForCluster(selected.clusterId))}
        zoomLevel={zoomLevel}
        onZoomIn={() => graphApi.current?.zoomBy(0.72)}
        onZoomOut={() => graphApi.current?.zoomBy(1.38)}
        onResetView={() => requestFit()}
        onFrameSelection={() => selected && graphApi.current?.focusNode(selected.id)}
        asOf={isHistorical ? timestampForRange(timeRange) : null}
        demoMode={demoMode}
      />

      <TimelineScrubber
        open={timelineOpen}
        range={timeRange}
        onRangeChange={setTimeRange}
        onClose={() => {
          setTimelineOpen(false);
          setTimeRange("Now");
        }}
        demoMode={demoMode}
        loading={historicalLoading}
        asOf={isHistorical ? timestampForRange(timeRange) : null}
      />

      {/* Interaction hints — the globe's controls aren't discoverable without
          them, and they double as the "you are looking at history" marker. */}
      <div className="pointer-events-none absolute bottom-4 left-1/2 z-10 hidden -translate-x-1/2 items-center gap-3 rounded-md border border-white/[0.06] bg-[#050810]/75 px-3 py-1.5 text-[9px] text-white/35 backdrop-blur-xl md:flex">
        {isHistorical ? (
          <span className="flex items-center gap-1.5 text-amber-300/80">
            <Clock className="h-3 w-3" />
            Historical · {timestampForRange(timeRange).toLocaleString()}
          </span>
        ) : null}
        <span>Click + drag to rotate</span>
        <span className="h-2.5 w-px bg-white/10" />
        <span>Scroll to zoom</span>
        <span className="h-2.5 w-px bg-white/10" />
        <span>
          <kbd className="rounded border border-white/[0.12] px-1 py-px font-sans text-[8px] text-white/50">R</kbd>{" "}
          Reset view
        </span>
      </div>
    </div>
  );
}

function hashStr(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(31, h) + s.charCodeAt(i)) | 0;
  return h;
}
