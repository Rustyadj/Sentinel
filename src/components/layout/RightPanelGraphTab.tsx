"use client";

import { Search, X } from "lucide-react";
import { useGraphStore } from "@/store/useGraphStore";
import { NodeFacetList, Stat, nodeTier } from "@/components/neural-lens/NodeFacets";
import { cn } from "@/lib/utils";

/**
 * Compact, docked counterpart to the graph's own canvas rails
 * (GraphControlRail/GraphContextRail). Reads and writes the same
 * useGraphStore state the canvas does — there is one selection/filter model,
 * not two — so toggling a type chip here filters the live graph, and
 * clicking a node on the canvas populates the detail card here too.
 */
export function GraphTab() {
  const search = useGraphStore((state) => state.search);
  const setSearch = useGraphStore((state) => state.setSearch);
  const availableTypes = useGraphStore((state) => state.availableTypes);
  const activeTypes = useGraphStore((state) => state.activeTypes);
  const toggleType = useGraphStore((state) => state.toggleType);
  const clearTypes = useGraphStore((state) => state.clearTypes);
  const selectedNode = useGraphStore((state) => state.selectedNode);
  const setSelectedNode = useGraphStore((state) => state.setSelectedNode);

  return (
    <div className="flex h-full flex-col gap-4 p-3">
      <div>
        <div className="mb-2 text-[10px] uppercase tracking-widest text-[--muted-foreground]">Find a node</div>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-[--muted-foreground]" />
          <input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Find a node…"
            className="w-full rounded-md border border-[--border] bg-transparent py-1.5 pl-7 pr-2 text-xs text-[--foreground] outline-none placeholder:text-[--muted-foreground] focus-visible:border-violet-400/50"
          />
        </div>
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-[--muted-foreground]">
          <span>Filter by type</span>
          {activeTypes.size > 0 ? (
            <button type="button" onClick={clearTypes} className="text-[9px] normal-case text-violet-300 hover:text-violet-200">
              Clear
            </button>
          ) : null}
        </div>
        {availableTypes.length ? (
          <div className="flex flex-wrap gap-1.5">
            {availableTypes.map((type) => (
              <button
                key={type}
                type="button"
                onClick={() => toggleType(type)}
                className={cn(
                  "rounded-full border px-2 py-0.5 text-[10px] transition-colors",
                  activeTypes.has(type)
                    ? "border-violet-400/40 bg-violet-500/15 text-violet-200"
                    : "border-[--border] text-[--muted-foreground] hover:text-[--foreground]"
                )}
              >
                {type}
              </button>
            ))}
          </div>
        ) : (
          <p className="text-[11px] text-[--muted-foreground]">No graph is on screen yet.</p>
        )}
      </div>

      <div className="min-h-0 flex-1 border-t border-[--border] pt-3">
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-[--muted-foreground]">
          <span>Selected node</span>
          {selectedNode ? (
            <button
              type="button"
              aria-label="Clear selection"
              onClick={() => setSelectedNode(null)}
              className="text-[--muted-foreground] hover:text-[--foreground]"
            >
              <X className="h-3 w-3" />
            </button>
          ) : null}
        </div>
        {selectedNode ? (
          <div className="space-y-3">
            <div>
              <div className="text-[9px] uppercase tracking-[0.18em] text-[--muted-foreground]">{selectedNode.type}</div>
              <div className="truncate text-xs font-medium text-[--foreground]">{selectedNode.label}</div>
            </div>
            <NodeFacetList node={selectedNode} />
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Degree" value={String(Math.round(selectedNode.val * 3))} />
              <Stat label="Weight" value={selectedNode.val.toFixed(1)} />
              <Stat label="Tier" value={nodeTier(selectedNode.val)} />
            </div>
          </div>
        ) : (
          <p className="text-[11px] text-[--muted-foreground]">Click a node in the graph to see its details here.</p>
        )}
      </div>
    </div>
  );
}
