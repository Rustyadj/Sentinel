"use client";

import { useState } from "react";
import {
  Clock3,
  Crosshair,
  Expand,
  Filter,
  Grid2X2,
  Lightbulb,
  Search,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useGraphStore, type GraphTimeWindow } from "@/store/useGraphStore";

const TIME_OPTIONS: Array<{ value: GraphTimeWindow; label: string }> = [
  { value: "all", label: "All time" },
  { value: "7d", label: "7 days" },
  { value: "30d", label: "30 days" },
  { value: "90d", label: "90 days" },
];

interface GraphToolbarProps {
  nodeTypes: string[];
  onFit: () => void;
}

/** Reference-matched vertical canvas tool rail with functional graph controls. */
export function GraphToolbar({ nodeTypes, onFit }: GraphToolbarProps) {
  const {
    search,
    setSearch,
    activeTypes,
    toggleType,
    clearTypes,
    focusMode,
    setFocusMode,
    clustering,
    setClustering,
    timeWindow,
    setTimeWindow,
  } = useGraphStore();
  const [openPanel, setOpenPanel] = useState<"search" | "filter" | "time" | null>(null);
  const [insights, setInsights] = useState(false);

  return (
    <div className="pointer-events-none absolute right-3 top-16 z-30 flex items-start gap-2">
      {openPanel === "search" ? (
        <div className="pointer-events-auto mt-0 flex w-64 items-center rounded-xl border border-[#203248] bg-[#08131f]/96 p-2 shadow-2xl backdrop-blur-xl">
          <Search className="ml-1 h-3.5 w-3.5 text-[#6e7b8d]" />
          <input
            autoFocus
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Search graph..."
            aria-label="Search graph nodes"
            className="h-8 min-w-0 flex-1 bg-transparent px-2 text-[11px] text-white outline-none placeholder:text-[#5d6a7c]"
          />
          <button type="button" onClick={() => setOpenPanel(null)} aria-label="Close search" className="p-1 text-[#718095] hover:text-white">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      ) : null}

      {openPanel === "filter" ? (
        <div className="pointer-events-auto w-48 rounded-xl border border-[#203248] bg-[#08131f]/96 p-2.5 shadow-2xl backdrop-blur-xl">
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[9px] font-medium uppercase tracking-[0.12em] text-[#778599]">Node types</span>
            {activeTypes.size > 0 ? (
              <button type="button" onClick={clearTypes} className="text-[9px] text-cyan-300">Clear</button>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-1">
            {nodeTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                aria-pressed={activeTypes.has(type)}
                className={cn(
                  "rounded-md border px-1.5 py-1 text-[9px]",
                  activeTypes.has(type)
                    ? "border-cyan-400/40 bg-cyan-400/10 text-cyan-200"
                    : "border-white/[0.07] text-[#8b98aa] hover:text-white"
                )}
              >
                {type}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {openPanel === "time" ? (
        <div className="pointer-events-auto w-32 overflow-hidden rounded-xl border border-[#203248] bg-[#08131f]/96 py-1.5 shadow-2xl backdrop-blur-xl">
          {TIME_OPTIONS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => {
                setTimeWindow(option.value);
                setOpenPanel(null);
              }}
              className={cn(
                "block w-full px-3 py-2 text-left text-[10px] hover:bg-white/[0.05]",
                timeWindow === option.value ? "text-cyan-300" : "text-[#aab5c4]"
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      ) : null}

      <aside className="pointer-events-auto hidden w-[54px] overflow-hidden rounded-xl border border-[#203248] bg-[#08131f]/92 shadow-2xl backdrop-blur-xl md:block">
        <Tool icon={Search} label="Search" active={openPanel === "search" || Boolean(search)} onClick={() => setOpenPanel(openPanel === "search" ? null : "search")} />
        <Tool icon={Filter} label="Filter" active={openPanel === "filter" || activeTypes.size > 0} onClick={() => setOpenPanel(openPanel === "filter" ? null : "filter")} />
        <Tool icon={Crosshair} label="Focus" active={focusMode} onClick={() => setFocusMode(!focusMode)} />
        <Tool icon={Expand} label="Expand" onClick={onFit} />
        <Tool icon={Grid2X2} label="Layout" active={clustering} onClick={() => setClustering(!clustering)} />
        <Tool icon={Clock3} label="Time Map" active={openPanel === "time" || timeWindow !== "all"} onClick={() => setOpenPanel(openPanel === "time" ? null : "time")} />
        <Tool icon={Lightbulb} label="Insights" active={insights} onClick={() => setInsights((value) => !value)} />
      </aside>

      <div className="pointer-events-auto flex rounded-xl border border-[#203248] bg-[#08131f]/92 p-1 shadow-2xl md:hidden">
        <button type="button" aria-label="Search graph nodes" onClick={() => setOpenPanel(openPanel === "search" ? null : "search")} className="p-2 text-[#9eabba]"><Search className="h-4 w-4" /></button>
        <button type="button" aria-label="Filter types" onClick={() => setOpenPanel(openPanel === "filter" ? null : "filter")} className="p-2 text-[#9eabba]"><Filter className="h-4 w-4" /></button>
        <button type="button" aria-label="Fit graph to view" onClick={onFit} className="p-2 text-[#9eabba]"><Expand className="h-4 w-4" /></button>
      </div>
    </div>
  );
}

function Tool({
  icon: Icon,
  label,
  active,
  onClick,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  active?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      aria-pressed={active}
      className={cn(
        "flex h-[58px] w-full flex-col items-center justify-center gap-1 border-b border-white/[0.055] text-[8px] transition-colors last:border-b-0",
        active ? "bg-cyan-400/10 text-cyan-300" : "text-[#a1adbd] hover:bg-white/[0.045] hover:text-white"
      )}
    >
      <Icon className="h-4 w-4 stroke-[1.45]" />
      <span>{label}</span>
    </button>
  );
}
