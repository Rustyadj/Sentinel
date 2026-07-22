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
    <div className="pointer-events-none absolute inset-x-0 bottom-0 z-20 flex h-9 items-center gap-4 border-t border-white/8 bg-[#050a12]/85 px-5 text-[10px] text-white/50 backdrop-blur-xl">
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
      <span className="capitalize text-white/40">{zoomLevel} view</span>
      <span className="ml-auto flex items-center gap-4">
        <span className="text-white/60">{nodeCount} nodes</span>
        <span className="text-white/60">{edgeCount} connections</span>
        <span className="flex items-center gap-1.5">
          <Mic className="h-3 w-3 text-white/30" />
          Voice ready
        </span>
      </span>
    </div>
  );
}
