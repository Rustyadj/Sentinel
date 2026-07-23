"use client";

import { Activity, Radio, Mic } from "lucide-react";

interface NeuralLensStatusBarProps {
  connected: boolean;
  nodeCount: number;
  edgeCount: number;
  zoomLevel: string;
  /** Set when the graph is showing reconstructed historical state, not live "now". */
  asOf?: Date | null;
}

export function NeuralLensStatusBar({
  connected,
  nodeCount,
  edgeCount,
  zoomLevel,
  asOf,
}: NeuralLensStatusBarProps) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 flex h-10 max-w-[calc(100%-24px)] -translate-x-1/2 items-center gap-4 rounded-xl border border-[#17273a] bg-[#07131f]/94 px-4 text-[9px] text-[#8996a8] shadow-2xl backdrop-blur-xl md:max-w-[calc(100%-80px)] md:gap-6">
      {asOf ? (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
          <span>Historical · {asOf.toLocaleString()}</span>
        </span>
      ) : (
        <span className="flex items-center gap-1.5 whitespace-nowrap">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          <span className="hidden sm:inline">All systems operational</span>
          <span className="sm:hidden">Operational</span>
        </span>
      )}
      <span className="hidden items-center gap-1.5 sm:flex">
        <Activity className="h-3 w-3 text-emerald-300/70" />
        Graph active
      </span>
      <span className="hidden items-center gap-1.5 md:flex">
        <Radio className={`h-3 w-3 ${connected && !asOf ? "text-emerald-300/70" : "text-white/30"}`} />
        {asOf ? "Live sync paused" : connected ? "Real-time sync" : "Reconnecting…"}
      </span>
      <span className="hidden capitalize text-white/40 lg:inline">{zoomLevel} view</span>
      <span className="ml-auto flex items-center gap-4 whitespace-nowrap">
        <span className="text-white/60">{nodeCount} nodes</span>
        <span className="hidden text-white/60 sm:inline">{edgeCount} connections</span>
        <span className="hidden items-center gap-1.5 md:flex">
          <Mic className="h-3 w-3 text-white/30" />
          Voice ready
        </span>
      </span>
    </div>
  );
}
