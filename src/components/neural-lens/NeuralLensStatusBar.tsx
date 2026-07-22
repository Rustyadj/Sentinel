"use client";

import { Activity, Radio, Mic } from "lucide-react";

interface NeuralLensStatusBarProps {
  connected: boolean;
  nodeCount: number;
  edgeCount: number;
  zoomLevel: string;
}

export function NeuralLensStatusBar({
  connected,
  nodeCount,
  edgeCount,
  zoomLevel,
}: NeuralLensStatusBarProps) {
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-30 flex h-10 max-w-[calc(100%-80px)] -translate-x-1/2 items-center gap-4 rounded-xl border border-[#17273a] bg-[#07131f]/94 px-4 text-[9px] text-[#8996a8] shadow-2xl backdrop-blur-xl md:gap-6">
      <span className="flex items-center gap-1.5">
        <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
        All systems operational
      </span>
      <span className="flex items-center gap-1.5">
        <Activity className="h-3 w-3 text-emerald-300/70" />
        Graph active
      </span>
      <span className="flex items-center gap-1.5">
        <Radio className={`h-3 w-3 ${connected ? "text-emerald-300/70" : "text-white/30"}`} />
        {connected ? "Real-time sync" : "Reconnecting…"}
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
