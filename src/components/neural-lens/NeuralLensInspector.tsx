"use client";

import { X, Crosshair, ExternalLink, Copy } from "lucide-react";
import { ACCENT_COLORS, NEUTRAL_NODE } from "./palette";
import { NodeFacetList, Stat, nodeTier } from "./NodeFacets";
import type { GraphNodeSummary } from "@/store/useGraphStore";

interface NeuralLensInspectorProps {
  node: GraphNodeSummary | null;
  /** A handful of the selected node's direct neighbors — "connected
   * entities," per the brief's detail-drawer spec. */
  connected: GraphNodeSummary[];
  onClose: () => void;
  onFocusConnected: (label: string) => void;
  onOpenModule: () => void;
}

/**
 * Node inspector — opens automatically at detail level / on click. Shows the
 * provenance-style facets the Neural Engine tracks, its direct neighbors,
 * and quick actions. Docks to the right so it never covers the graph
 * itself. For DEMO nodes these are illustrative; SCOPED nodes would be
 * enriched from /api/knowledge/objects.
 *
 * Presentational building blocks (Facet/Stat) live in ./NodeFacets so
 * RightPanel's compact Graph tab can render the same node detail without
 * duplicating this markup.
 */
export function NeuralLensInspector({ node, connected, onClose, onFocusConnected, onOpenModule }: NeuralLensInspectorProps) {
  if (!node) return null;
  const color = node.accent ? ACCENT_COLORS[node.type] ?? NEUTRAL_NODE : NEUTRAL_NODE;

  return (
    <div className="pointer-events-auto absolute right-20 top-4 z-30 w-72 rounded-xl border border-white/10 bg-[#070c14]/92 p-4 shadow-2xl backdrop-blur-xl">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/40">{node.type}</div>
          <div className="truncate text-sm font-medium text-white/90">{node.label}</div>
        </div>
        <button onClick={onClose} className="text-white/40 hover:text-white">
          <X className="h-4 w-4" />
        </button>
      </div>

      <div className="mt-3">
        <NodeFacetList node={node} />
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-white/8 pt-3">
        <Stat label="Degree" value={String(Math.round(node.val * 3))} />
        <Stat label="Weight" value={node.val.toFixed(1)} />
        <Stat label="Tier" value={nodeTier(node.val)} />
      </div>

      {connected.length > 0 && (
        <div className="mt-3 border-t border-white/8 pt-3">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">Connected</div>
          <div className="mt-1.5 space-y-0.5">
            {connected.map((entity) => (
              <button
                key={entity.id}
                onClick={() => onFocusConnected(entity.label)}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1 text-left text-[11px] text-white/60 hover:bg-white/6 hover:text-white/90"
              >
                <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-white/25" />
                <span className="truncate">{entity.label}</span>
                <span className="ml-auto shrink-0 text-[9px] uppercase tracking-wide text-white/30">{entity.type}</span>
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="mt-3 flex items-center gap-1.5 border-t border-white/8 pt-3">
        <button
          onClick={onOpenModule}
          className="flex flex-1 items-center justify-center gap-1.5 rounded-md border border-white/10 py-1.5 text-[10.5px] text-white/70 hover:bg-white/6"
        >
          <ExternalLink className="h-3 w-3" />
          Open module
        </button>
        <button
          onClick={() => void navigator.clipboard.writeText(node.id)}
          title="Copy node id"
          className="rounded-md border border-white/10 p-1.5 text-white/50 hover:bg-white/6 hover:text-white/80"
        >
          <Copy className="h-3 w-3" />
        </button>
        <button
          onClick={() => onFocusConnected(node.label)}
          title="Refocus camera"
          className="rounded-md border border-white/10 p-1.5 text-white/50 hover:bg-white/6 hover:text-white/80"
        >
          <Crosshair className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
