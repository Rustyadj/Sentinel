"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { NeuralLensGraph } from "./NeuralLensGraph";
import { NeuralLensPanel } from "./NeuralLensPanel";
import { NeuralLensToolbar } from "./NeuralLensToolbar";
import { NeuralLensStatusBar } from "./NeuralLensStatusBar";
import { NeuralLensInspector } from "./NeuralLensInspector";
import { NeuralLensMinimap } from "./NeuralLensMinimap";
import { TimelineScrubber, type TimeRange } from "./TimelineScrubber";
import { generateDemoGraph } from "./demoGraph";
import { buildLensGraphFromApi } from "./fromApiGraph";
import { useNeuralStream } from "./useNeuralStream";
import type { SemanticZoomLevel } from "./palette";
import type { LensGraph, LensId, LensNode } from "./types";

const LENS_TYPES: Record<LensId, string[]> = {
  Knowledge: ["Note", "Memory", "Decision", "Concept", "Conversation", "Message", "File"],
  Execution: ["Agent", "Task", "Artifact", "Project", "Workflow"],
  People: ["Agent", "Organization", "Workspace", "Project"],
};

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
  const [lens, setLens] = useState<LensId>("Knowledge");
  const [activeTypes, setActiveTypes] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<LensNode | null>(null);
  const [zoomLevel, setZoomLevel] = useState<SemanticZoomLevel>("galaxy");
  const [toolbarAction, setToolbarAction] = useState<string | null>(null);
  const [timelineOpen, setTimelineOpen] = useState(false);
  const [timeRange, setTimeRange] = useState<TimeRange>("Now");
  const [historicalGraph, setHistoricalGraph] = useState<LensGraph | null>(null);
  const [historicalLoading, setHistoricalLoading] = useState(false);
  const [activeNodeIds, setActiveNodeIds] = useState<Set<string>>(new Set());
  const isHistorical = !demoMode && timeRange !== "Now";

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

  // Apply type + search filters. Default (no active chips) shows the whole
  // constellation — the lens is a preset that sets the active chips, not a
  // hard default filter — so the graph reads dense on load like the reference.
  const filteredGraph = useMemo<LensGraph>(() => {
    const q = search.trim().toLowerCase();

    const nodes = baseGraph.nodes.filter((n) => {
      const typeOk = n.val >= 6 || activeTypes.size === 0 || activeTypes.has(n.type); // always keep hubs
      const searchOk = q === "" || n.label.toLowerCase().includes(q);
      return typeOk && searchOk;
    });
    const keep = new Set(nodes.map((n) => n.id));
    const links = baseGraph.links.filter((l) => keep.has(l.source) && keep.has(l.target));
    return { nodes, links, meta: { ...baseGraph.meta, nodeCount: nodes.length, edgeCount: links.length } };
  }, [baseGraph, activeTypes, search]);

  const typeChips = useMemo(() => {
    const set = new Set<string>();
    for (const n of baseGraph.nodes) if (n.val < 6) set.add(n.type);
    return [...set].sort();
  }, [baseGraph.nodes]);

  const handleToggleType = useCallback((type: string) => {
    setActiveTypes((prev) => {
      const next = new Set(prev);
      if (next.has(type)) next.delete(type);
      else next.add(type);
      return next;
    });
  }, []);

  const handleToolbarAction = useCallback((id: string) => {
    setToolbarAction((prev) => (prev === id ? null : id));
    if (id === "time") setTimelineOpen((v) => !v);
  }, []);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#010409]">
      <NeuralLensGraph
        graph={filteredGraph}
        activeNodeIds={activeNodeIds}
        onSelect={setSelected}
        onZoomLevel={setZoomLevel}
      />

      <NeuralLensPanel
        lens={lens}
        onLensChange={(next) => {
          setLens(next);
          // Selecting a lens applies its type preset as the active filter;
          // re-selecting the same lens clears back to the full graph.
          setActiveTypes((prev) => {
            const preset = new Set(LENS_TYPES[next]);
            const same = prev.size === preset.size && [...preset].every((t) => prev.has(t));
            return same ? new Set() : preset;
          });
        }}
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
      <NeuralLensInspector node={selected} onClose={() => setSelected(null)} />
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
