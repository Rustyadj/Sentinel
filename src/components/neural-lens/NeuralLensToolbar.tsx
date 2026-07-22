"use client";

import { Search, Filter, Focus, Maximize2, LayoutGrid, Clock, Sparkles } from "lucide-react";

interface ToolbarButton {
  id: string;
  icon: typeof Search;
  label: string;
}

const BUTTONS: ToolbarButton[] = [
  { id: "search", icon: Search, label: "Search" },
  { id: "filter", icon: Filter, label: "Filter" },
  { id: "focus", icon: Focus, label: "Focus" },
  { id: "expand", icon: Maximize2, label: "Expand" },
  { id: "layout", icon: LayoutGrid, label: "Layout" },
  { id: "time", icon: Clock, label: "Time Map" },
  { id: "insights", icon: Sparkles, label: "Insights" },
];

interface NeuralLensToolbarProps {
  active: string | null;
  onAction: (id: string) => void;
}

export function NeuralLensToolbar({ active, onAction }: NeuralLensToolbarProps) {
  return (
    <div className="pointer-events-auto absolute right-4 top-1/2 z-20 flex -translate-y-1/2 flex-col gap-1 rounded-xl border border-white/10 bg-[#070c14]/85 p-1.5 shadow-2xl backdrop-blur-xl">
      {BUTTONS.map(({ id, icon: Icon, label }) => (
        <button
          key={id}
          title={label}
          onClick={() => onAction(id)}
          className={`flex h-11 w-11 flex-col items-center justify-center gap-0.5 rounded-lg transition-colors ${
            active === id ? "bg-indigo-500/20 text-indigo-200" : "text-white/45 hover:bg-white/8 hover:text-white/80"
          }`}
        >
          <Icon className="h-4 w-4" />
          <span className="text-[7px] uppercase tracking-wide">{label}</span>
        </button>
      ))}
    </div>
  );
}
