"use client";

import { Hash, Clock, ShieldCheck } from "lucide-react";

/**
 * Shared node-detail building blocks — used by both the floating
 * NeuralLensInspector (on-canvas, immersive) and RightPanel's compact Graph
 * tab (docked). Kept presentational and layout-agnostic so each caller can
 * wrap them in whatever container suits its context.
 */

export function Facet({
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

export function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-white/5 px-2 py-1.5 text-center">
      <div className="text-[9px] uppercase tracking-wide text-white/35">{label}</div>
      <div className="text-xs font-medium text-white/85">{value}</div>
    </div>
  );
}

/** Tier label used consistently anywhere a node's weight is summarized. */
export function nodeTier(val: number): string {
  return val >= 6 ? "Hub" : val >= 2.4 ? "Child" : "Leaf";
}

export function NodeFacetList({
  node,
}: {
  node: { id: string; hubId?: string; accent?: boolean; active?: boolean };
}) {
  return (
    <div className="space-y-2 text-[11px]">
      <Facet icon={ShieldCheck} label="Provenance" value={node.accent ? "Curated" : "Derived"} />
      {node.hubId ? <Facet icon={Clock} label="Cluster" value={node.hubId} /> : null}
      <Facet icon={Hash} label="Node id" value={node.id} mono />
      {node.active && (
        <div className="flex items-center gap-1.5 text-emerald-300/80">
          <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-emerald-400" />
          Active in the last event
        </div>
      )}
    </div>
  );
}
