"use client";

import { useMemo, useState } from "react";
import { Orbit, Loader2, Radar, X, Sparkles } from "lucide-react";
import {
  buildNeuralData,
  localCluster,
  selectVisible,
  type NeuralNode,
} from "../lib/visual";
import { useNeuralGraphData } from "../lib/useNeuralGraphData";
import { useRetrievalPaths } from "../lib/useRetrievalPaths";
import { NeuralGraph } from "./NeuralGraph";

/** Max nodes drawn in the full galaxy before LOD trims the long tail. */
const FOCUS_CAP = 900;

const LEGEND: { label: string; color: string }[] = [
  { label: "Neutral", color: "rgb(188,199,214)" },
  { label: "Memory", color: "rgb(126,168,132)" },
  { label: "Document", color: "rgb(120,150,190)" },
  { label: "Agent", color: "rgb(196,170,120)" },
  { label: "Concept", color: "rgb(150,132,186)" },
];

export function NeuralSpacePage() {
  const { graph, loading, error, reload } = useNeuralGraphData();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [selected, setSelected] = useState<NeuralNode | null>(null);

  const mode = focusId ? "cluster" : "focus";

  // Canonical → visible subgraph (LOD in focus, isolation in cluster mode).
  const visible = useMemo(() => {
    if (!graph) return null;
    const base =
      focusId != null
        ? localCluster(graph, focusId, 2)
        : selectVisible(graph, FOCUS_CAP);
    return buildNeuralData(base);
  }, [graph, focusId]);

  const activeEdgeIds = useRetrievalPaths(
    visible ?? { nodes: [], links: [] },
    !loading,
  );

  const focusLabel = useMemo(() => {
    if (!focusId || !graph) return null;
    return graph.objects.find((o) => o.id === focusId)?.label ?? null;
  }, [focusId, graph]);

  return (
    <div className="relative h-full w-full overflow-hidden bg-[#05060a]">
      {/* Galaxy */}
      {visible && visible.nodes.length > 0 && (
        <NeuralGraph
          data={visible}
          mode={mode}
          activeEdgeIds={activeEdgeIds}
          onNodeClick={setSelected}
          onNodeIsolate={(n) => {
            setSelected(n);
            setFocusId(n.id);
          }}
        />
      )}

      {/* Loading veil */}
      {loading && (
        <div className="absolute inset-0 z-20 flex items-center justify-center">
          <div className="flex items-center gap-2 text-[13px] text-white/60">
            <Loader2 className="h-4 w-4 animate-spin" />
            Charting neural space…
          </div>
        </div>
      )}

      {/* Overlay chrome — non-blocking except its own controls */}
      <div className="pointer-events-none absolute inset-0 z-10 flex flex-col justify-between p-5">
        {/* Top bar */}
        <div className="flex items-start justify-between">
          <div className="pointer-events-auto flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-white/10 bg-white/5 backdrop-blur-xl">
              <Orbit className="h-4.5 w-4.5 text-violet-300" />
            </div>
            <div>
              <div className="text-sm font-semibold text-white/90">
                Sentinel Neural Space
              </div>
              <div className="flex items-center gap-2 text-[11px] text-white/40">
                <span className="flex items-center gap-1">
                  <Radar className="h-3 w-3" />
                  {mode === "cluster"
                    ? focusLabel
                      ? `Local Cluster · ${focusLabel}`
                      : "Local Cluster"
                    : "Neural Focus"}
                </span>
                {graph && (
                  <span>
                    · {visible?.nodes.length ?? 0} / {graph.objects.length} nodes
                  </span>
                )}
                {graph?.meta?.sample && (
                  <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50">
                    sample data
                  </span>
                )}
              </div>
            </div>
          </div>

          {focusId && (
            <button
              onClick={() => {
                setFocusId(null);
                setSelected(null);
              }}
              className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-white/70 backdrop-blur-xl transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
              Exit cluster
            </button>
          )}
        </div>

        {/* Bottom bar */}
        <div className="flex items-end justify-between">
          {/* Legend */}
          <div className="pointer-events-auto flex flex-wrap items-center gap-3 rounded-xl border border-white/10 bg-black/30 px-3 py-2 backdrop-blur-xl">
            {LEGEND.map((l) => (
              <div key={l.label} className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ backgroundColor: l.color }}
                />
                <span className="text-[11px] text-white/55">{l.label}</span>
              </div>
            ))}
          </div>

          {/* Selected node card */}
          {selected && (
            <div className="pointer-events-auto max-w-xs rounded-xl border border-white/10 bg-black/40 p-3 backdrop-blur-xl">
              <div className="mb-1 flex items-center gap-1.5">
                <Sparkles className="h-3.5 w-3.5 text-violet-300" />
                <span className="text-[10px] uppercase tracking-widest text-white/40">
                  {selected.kind}
                </span>
                {selected.active && (
                  <span className="ml-auto flex items-center gap-1 text-[10px] text-emerald-300/80">
                    <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
                    active
                  </span>
                )}
              </div>
              <div className="text-sm font-medium text-white/90">
                {selected.label}
              </div>
              <div className="mt-1 text-[11px] text-white/40">
                {selected.degree} connection{selected.degree === 1 ? "" : "s"} ·
                importance {(selected.importance * 100).toFixed(0)}%
              </div>
              <div className="mt-2 text-[10px] text-white/30">
                Double-click a node to isolate its cluster
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Error toast (non-fatal — sample data is showing) */}
      {error && !loading && (
        <button
          onClick={reload}
          className="absolute bottom-5 left-1/2 z-20 -translate-x-1/2 rounded-lg border border-amber-500/20 bg-amber-500/10 px-3 py-1.5 text-[11px] text-amber-200/80"
        >
          Live graph unavailable — showing sample. Retry
        </button>
      )}
    </div>
  );
}
