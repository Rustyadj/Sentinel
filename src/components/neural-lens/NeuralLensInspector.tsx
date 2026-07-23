"use client";

import { X, Hash, Clock, ShieldCheck } from "lucide-react";
import { ACCENT_COLORS, NEUTRAL_NODE } from "./palette";
import type { LensNode } from "./types";

interface NeuralLensInspectorProps {
  node: LensNode | null;
  onClose: () => void;
}

/**
 * Node inspector — opens automatically at detail level / on click. Shows the
 * provenance-style facets the Neural Engine tracks. For DEMO nodes these are
 * illustrative; SCOPED nodes would be enriched from /api/knowledge/objects.
 */
export function NeuralLensInspector({ node, onClose }: NeuralLensInspectorProps) {
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

      <div className="mt-3 space-y-2 text-[11px]">
        <Facet icon={ShieldCheck} label="Provenance" value={node.accent ? "Curated" : "Derived"} />
        <Facet icon={Clock} label="Cluster" value={node.hubId} />
        <Facet icon={Hash} label="Node id" value={node.id} mono />
        {node.active && (
          <div className="flex items-center gap-1.5 text-emerald-300/80">
            <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
            Active in the last event
          </div>
        )}
      </div>

      <div className="mt-3 grid grid-cols-3 gap-1.5 border-t border-white/8 pt-3">
        <Stat label="Degree" value={String(Math.round(node.val * 3))} />
        <Stat label="Weight" value={node.val.toFixed(1)} />
        <Stat label="Tier" value={node.val >= 6 ? "Hub" : node.val >= 2.4 ? "Child" : "Leaf"} />
      </div>
    </div>
  );
}

function Facet({
  icon: Icon,
  label,
  value,
  mono,
}: {
  icon: typeof Clock;
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-center gap-2">
      <Icon className="h-3 w-3 shrink-0 text-white/35" />
      <span className="text-white/40">{label}</span>
      <span className={`ml-auto max-w-[55%] truncate text-white/70 ${mono ? "font-mono text-[10px]" : ""}`}>
        {value}
      </span>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-wide text-white/35">{label}</div>
      <div className="text-xs font-medium text-white/85">{value}</div>
    </div>
  );
}
