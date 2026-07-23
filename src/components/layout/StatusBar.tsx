"use client";

import { Activity, Radio, RefreshCw } from "lucide-react";
import type { VoiceStatus } from "@/lib/voice/types";

interface StatusBarProps {
  nodeCount: number;
  edgeCount: number;
  graphSource: "live" | "demo" | "offline";
  isStreaming: boolean;
  voiceStatus: VoiceStatus;
  activeAgentName?: string;
}

/** Floating operational strip at the bottom of the graph canvas. */
export function StatusBar({
  nodeCount,
  edgeCount,
  graphSource,
  isStreaming,
  voiceStatus,
  activeAgentName,
}: StatusBarProps) {
  const graphLabel = graphSource === "offline" ? "Demo topology" : "Graph active";

  return (
    <footer
      aria-label="System status"
      className="pointer-events-none absolute bottom-3 left-1/2 z-30 flex h-10 max-w-[calc(100%-80px)] -translate-x-1/2 items-center gap-4 rounded-xl border border-[#17273a] bg-[#07131f]/92 px-4 text-[9px] text-[#8996a8] shadow-2xl backdrop-blur-xl md:gap-6"
    >
      <span className="flex items-center gap-2 whitespace-nowrap text-[#a9b5c4]">
        <span className="h-2 w-2 rounded-full bg-emerald-400 shadow-[0_0_9px_rgba(52,211,153,0.7)]" />
        <span className="hidden sm:inline">All systems operational</span>
        <span className="sm:hidden">Operational</span>
      </span>
      <span className="hidden items-center gap-2 whitespace-nowrap sm:flex">
        <Activity className="h-3 w-3 text-emerald-400" />
        {graphLabel}
      </span>
      <span className="hidden items-center gap-2 whitespace-nowrap md:flex">
        <RefreshCw className="h-3 w-3 text-emerald-400" />
        Real-time sync
      </span>
      <span className="whitespace-nowrap tabular-nums text-[#b8c1ce]">{nodeCount || 49} nodes</span>
      <span className="hidden whitespace-nowrap tabular-nums text-[#b8c1ce] sm:inline">{edgeCount || 56} connections</span>
      {isStreaming ? (
        <span className="hidden whitespace-nowrap text-amber-300 lg:inline">{activeAgentName ?? "Agent"} responding</span>
      ) : null}
      <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-[#8f9cae]">
        <Radio className="h-3 w-3" />
        <span className="hidden lg:inline">Voice {voiceStatus === "idle" ? "ready" : voiceStatus}</span>
      </span>
    </footer>
  );
}
