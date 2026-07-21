"use client";

import { CircleDot, Eye, Layers3, Search, Sparkles, UsersRound, Workflow } from "lucide-react";
import { useGraphStore } from "@/store/useGraphStore";
import { cn } from "@/lib/utils";
import type { GraphSource } from "./KnowledgeGraph";

const LENSES = [
  { id: "knowledge", label: "Knowledge", icon: Sparkles, types: ["Memory", "Note", "File", "Artifact", "Decision"] },
  { id: "execution", label: "Execution", icon: Workflow, types: ["Project", "Task", "Workflow"] },
  { id: "people", label: "People", icon: UsersRound, types: ["Agent", "Person", "Organization"] },
] as const;

export function NeuralLens({
  visible,
  nodeTypes,
  nodeCount,
  edgeCount,
  source,
  projectName,
}: {
  visible: boolean;
  nodeTypes: string[];
  nodeCount: number;
  edgeCount: number;
  source: GraphSource;
  projectName?: string;
}) {
  const { search, setSearch, activeTypes, setTypes, toggleType, clearTypes } = useGraphStore();
  if (!visible) return null;

  const activeLens = LENSES.find((lens) => {
    const available = lens.types.filter((type) => nodeTypes.includes(type));
    return available.length > 0 && available.every((type) => activeTypes.has(type)) && activeTypes.size === available.length;
  })?.id;

  return (
    <aside className="absolute left-20 top-4 z-30 hidden w-48 overflow-hidden rounded-xl border border-[#203248] bg-[#07131f]/94 shadow-[0_24px_70px_rgba(0,0,0,.48)] backdrop-blur-xl xl:block" aria-label="Neural graph lens">
      <div className="flex items-center gap-2 border-b border-white/[0.07] px-3 py-3">
        <Layers3 className="h-3.5 w-3.5 text-violet-300" />
        <span className="text-[9px] font-semibold uppercase tracking-[0.18em] text-[#9aa8ba]">Neural lens</span>
        <span className={cn("ml-auto h-1.5 w-1.5 rounded-full", source === "live" ? "bg-emerald-400 shadow-[0_0_9px_#34d399]" : "bg-amber-400")} />
      </div>

      <div className="space-y-1 p-2">
        {LENSES.map((lens) => {
          const Icon = lens.icon;
          const available = lens.types.filter((type) => nodeTypes.includes(type));
          return (
            <button
              key={lens.id}
              type="button"
              disabled={available.length === 0}
              onClick={() => activeLens === lens.id ? clearTypes() : setTypes(available)}
              className={cn(
                "flex h-9 w-full items-center gap-2 rounded-lg px-2.5 text-left text-[11px] outline-none transition-colors focus-visible:ring-2 focus-visible:ring-violet-400/60",
                activeLens === lens.id ? "bg-violet-500/18 text-white" : "text-[#8d9bad] hover:bg-white/[0.045] hover:text-white",
                available.length === 0 && "cursor-not-allowed opacity-35"
              )}
            >
              <span className={cn("grid h-5 w-5 place-items-center rounded-md border", activeLens === lens.id ? "border-violet-400/45 bg-violet-400/10 text-violet-200" : "border-white/[0.09]")}><Icon className="h-3 w-3" /></span>
              {lens.label}
            </button>
          );
        })}
      </div>

      <div className="border-t border-white/[0.07] px-3 py-3">
        <div className="text-[8px] font-semibold uppercase tracking-[0.16em] text-[#607087]">Working set</div>
        <div className="mt-2 truncate text-[10px] text-[#c6d0dd]">{projectName ?? "Sentinel OS"}</div>
        <div className="mt-1 flex gap-3 text-[8px] text-[#6f7f94]"><span>{nodeCount} nodes</span><span>{edgeCount} edges</span></div>
        <div className="mt-3 flex flex-wrap gap-1">
          {nodeTypes.slice(0, 8).map((type) => (
            <button key={type} type="button" onClick={() => toggleType(type)} aria-pressed={activeTypes.has(type)} className={cn("rounded-md border px-1.5 py-1 text-[8px] transition-colors", activeTypes.has(type) ? "border-cyan-400/35 bg-cyan-400/10 text-cyan-200" : "border-white/[0.07] text-[#77869a] hover:text-white")}>{type}</button>
          ))}
        </div>
      </div>

      <label className="relative block border-t border-white/[0.07] p-2">
        <span className="sr-only">Search neural graph</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 h-3 w-3 -translate-y-1/2 text-[#607087]" />
        <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search graph…" className="h-8 w-full rounded-lg border border-white/[0.07] bg-black/20 pl-7 pr-2 text-[10px] text-white outline-none placeholder:text-[#55657a] focus:border-violet-400/40" />
      </label>

      <div className="flex items-center justify-between border-t border-white/[0.07] px-3 py-2 text-[8px] uppercase tracking-[0.12em] text-[#607087]">
        <span className="flex items-center gap-1.5"><CircleDot className="h-3 w-3 text-emerald-300" />{source}</span>
        <span className="flex items-center gap-1"><Eye className="h-3 w-3" /> scoped</span>
      </div>
    </aside>
  );
}
