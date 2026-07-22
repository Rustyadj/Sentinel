"use client";

import { Layers, Network, Cpu, Users, Search } from "lucide-react";
import { ACCENT_COLORS, NEUTRAL_NODE } from "./palette";
import type { LensId } from "./types";

const LENSES: { id: LensId; icon: typeof Network; label: string }[] = [
  { id: "Knowledge", icon: Network, label: "Knowledge" },
  { id: "Execution", icon: Cpu, label: "Execution" },
  { id: "People", icon: Users, label: "People" },
];

interface NeuralLensPanelProps {
  lens: LensId;
  onLensChange: (lens: LensId) => void;
  workingSetName: string;
  nodeCount: number;
  edgeCount: number;
  typeChips: string[];
  activeTypes: Set<string>;
  onToggleType: (type: string) => void;
  search: string;
  onSearchChange: (v: string) => void;
  demoMode: boolean;
  onToggleDemoMode: (demo: boolean) => void;
}

export function NeuralLensPanel({
  lens,
  onLensChange,
  workingSetName,
  nodeCount,
  edgeCount,
  typeChips,
  activeTypes,
  onToggleType,
  search,
  onSearchChange,
  demoMode,
  onToggleDemoMode,
}: NeuralLensPanelProps) {
  return (
    <div className="pointer-events-auto absolute left-16 top-4 z-20 hidden w-56 rounded-xl border border-white/10 bg-[#070c14]/92 p-3 shadow-2xl backdrop-blur-xl sm:block">
      <div className="mb-3 flex items-center gap-2">
        <Layers className="h-4 w-4 text-indigo-300" />
        <span className="text-[11px] font-semibold uppercase tracking-[0.16em] text-white/80">
          Neural Lens
        </span>
        <span className="ml-auto h-1.5 w-1.5 animate-pulse rounded-full bg-amber-400" />
      </div>

      <div className="space-y-0.5">
        {LENSES.map(({ id, icon: Icon, label }) => (
          <button
            key={id}
            onClick={() => onLensChange(id)}
            className={`flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-colors ${
              lens === id ? "bg-white/10 text-white" : "text-white/50 hover:bg-white/5 hover:text-white/80"
            }`}
          >
            <Icon className="h-3.5 w-3.5" />
            {label}
          </button>
        ))}
      </div>

      <div className="mt-3 border-t border-white/8 pt-3">
        <div className="text-[9px] uppercase tracking-[0.18em] text-white/35">Working set</div>
        <div className="mt-1 text-xs font-medium text-white/85">{workingSetName}</div>
        <div className="mt-0.5 text-[10px] text-white/40">
          {nodeCount} nodes · {edgeCount} edges
        </div>

        <div className="mt-2.5 flex flex-wrap gap-1">
          {typeChips.map((type) => {
            const active = activeTypes.size === 0 || activeTypes.has(type);
            const color = ACCENT_COLORS[type] ?? NEUTRAL_NODE;
            return (
              <button
                key={type}
                onClick={() => onToggleType(type)}
                className="flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[9px] transition-colors"
                style={{
                  borderColor: active ? `${color}66` : "rgba(255,255,255,0.08)",
                  color: active ? color : "rgba(255,255,255,0.4)",
                  backgroundColor: active ? `${color}14` : "transparent",
                }}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
                {type}
              </button>
            );
          })}
        </div>
      </div>

      <div className="mt-3 border-t border-white/8 pt-3">
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            placeholder="Search graph…"
            className="h-7 w-full rounded-md border border-white/10 bg-white/5 pl-7 pr-2 text-[11px] text-white/80 placeholder:text-white/30 outline-none focus:border-indigo-400/40"
          />
        </div>
      </div>

      <div className="mt-3 flex items-center justify-between border-t border-white/8 pt-3 text-[10px]">
        <button
          onClick={() => onToggleDemoMode(true)}
          className={`flex items-center gap-1 ${demoMode ? "text-emerald-300" : "text-white/40"}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${demoMode ? "bg-emerald-400" : "bg-white/20"}`} />
          DEMO
        </button>
        <button
          onClick={() => onToggleDemoMode(false)}
          className={`flex items-center gap-1 ${!demoMode ? "text-indigo-300" : "text-white/40"}`}
        >
          <span className={`h-1.5 w-1.5 rounded-full ${!demoMode ? "bg-indigo-400" : "bg-white/20"}`} />
          SCOPED
        </button>
      </div>
    </div>
  );
}
