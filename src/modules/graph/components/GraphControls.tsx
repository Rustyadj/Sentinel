"use client";

import { useEffect, useState } from "react";
import { Filter, Loader2, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { CLUSTER_LABEL, TIME_WINDOWS, type SemanticCluster, type TimeWindowId } from "@/lib/graph/semantics";
import type { KnowledgeNode, KnowledgeObjectType } from "@/lib/knowledge/types";

const CLUSTER_TYPES: Record<SemanticCluster, KnowledgeObjectType[]> = {
  agent: ["Agent", "Person"],
  project: ["Project"],
  workspace: ["Workspace", "Repository"],
  knowledge: ["Note", "Decision"],
  memory: ["Memory"],
  tool: ["Module", "Workflow", "Task"],
  source: ["File", "Artifact"],
  conversation: ["Conversation", "Message"],
  external: ["Organization"],
};

/**
 * Search and filters collapse to a single row. The graph is the surface; its
 * controls never occupy a quarter of it.
 */
export function GraphControls({ activeClusters, onClustersChange, timeWindow, onTimeWindowChange, onFocusNode, resultCount, partial, loading }: {
  activeClusters: SemanticCluster[];
  onClustersChange: (clusters: SemanticCluster[]) => void;
  timeWindow: TimeWindowId;
  onTimeWindowChange: (window: TimeWindowId) => void;
  onFocusNode: (node: KnowledgeNode) => void;
  resultCount: number;
  partial: boolean;
  loading: boolean;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<KnowledgeNode[]>([]);
  const [searching, setSearching] = useState(false);

  useEffect(() => {
    const term = query.trim();
    let cancelled = false;
    if (term.length < 2) {
      const clear = setTimeout(() => { if (!cancelled) { setResults([]); setSearching(false); } }, 0);
      return () => { cancelled = true; clearTimeout(clear); };
    }
    const timer = setTimeout(async () => {
      setSearching(true);
      try {
        const response = await fetch(`/api/graph/search?q=${encodeURIComponent(term)}`);
        const body = await response.json();
        if (!cancelled) setResults(response.ok ? (body.nodes as KnowledgeNode[]) : []);
      } catch {
        if (!cancelled) setResults([]);
      } finally {
        if (!cancelled) setSearching(false);
      }
    }, 200);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [query]);

  const clusters = Object.keys(CLUSTER_LABEL) as SemanticCluster[];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-0 z-10 flex flex-col gap-2 p-4">
      <div className="pointer-events-auto flex flex-wrap items-center gap-2">
        <div className="relative">
          <div className="flex w-[20rem] items-center gap-2 rounded-xl bg-[--card] px-3 py-2 shadow-[var(--shadow-md)]">
            <Search className="h-3.5 w-3.5 text-[--muted-foreground]" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Search nodes"
              className="w-full bg-transparent text-[13px] outline-none placeholder:text-[--muted-foreground]"
            />
            {searching ? <Loader2 className="h-3.5 w-3.5 animate-spin text-[--muted-foreground]" /> : null}
            {query ? (
              <button aria-label="Clear search" onClick={() => setQuery("")}><X className="h-3.5 w-3.5 text-[--muted-foreground]" /></button>
            ) : null}
          </div>

          {results.length > 0 ? (
            <div className="absolute left-0 top-full mt-1 max-h-64 w-[20rem] overflow-y-auto rounded-xl bg-[--card] py-1 shadow-[var(--shadow-lg)]">
              {results.map((node) => (
                <button
                  key={node.id}
                  onClick={() => { onFocusNode(node); setQuery(""); setResults([]); }}
                  className="block w-full px-3 py-1.5 text-left hover:bg-[--muted]"
                >
                  <span className="block truncate text-[13px]">{node.title}</span>
                  <span className="block text-[11px] text-[--muted-foreground]">{node.type}</span>
                </button>
              ))}
            </div>
          ) : null}
        </div>

        <button
          onClick={() => setFiltersOpen((open) => !open)}
          aria-expanded={filtersOpen}
          className={cn(
            "flex items-center gap-1.5 rounded-xl bg-[--card] px-3 py-2 text-[13px] shadow-[var(--shadow-md)] transition-colors",
            filtersOpen ? "text-[--foreground]" : "text-[--muted-foreground] hover:text-[--foreground]",
          )}
        >
          <Filter className="h-3.5 w-3.5" />
          Filters
          {activeClusters.length ? <span className="text-[11px]">({activeClusters.length})</span> : null}
        </button>

        <div className="flex items-center gap-1 rounded-xl bg-[--card] p-1 shadow-[var(--shadow-md)]">
          {TIME_WINDOWS.map((window) => (
            <button
              key={window.id}
              onClick={() => onTimeWindowChange(window.id)}
              className={cn(
                "rounded-lg px-2.5 py-1 text-[12px] transition-colors",
                timeWindow === window.id ? "bg-[--muted] text-[--foreground]" : "text-[--muted-foreground] hover:text-[--foreground]",
              )}
            >
              {window.label}
            </button>
          ))}
        </div>

        <span className="rounded-xl bg-[--card] px-3 py-2 text-[12px] text-[--muted-foreground] shadow-[var(--shadow-md)]">
          {loading ? "Loading…" : `${resultCount} nodes${partial ? " · more available" : ""}`}
        </span>
      </div>

      {filtersOpen ? (
        <div className="pointer-events-auto flex max-w-[42rem] flex-wrap gap-1.5 rounded-xl bg-[--card] p-2 shadow-[var(--shadow-md)]">
          {clusters.map((cluster) => {
            const active = activeClusters.includes(cluster);
            return (
              <button
                key={cluster}
                onClick={() => onClustersChange(active ? activeClusters.filter((entry) => entry !== cluster) : [...activeClusters, cluster])}
                className={cn(
                  "flex items-center gap-1.5 rounded-lg px-2.5 py-1 text-[12px] transition-colors",
                  active ? "bg-[--muted] text-[--foreground]" : "text-[--muted-foreground] hover:text-[--foreground]",
                )}
              >
                <span className="h-1.5 w-1.5 rounded-full" style={{ background: `var(--entity-${cluster})` }} />
                {CLUSTER_LABEL[cluster]}
              </button>
            );
          })}
          {activeClusters.length ? (
            <button onClick={() => onClustersChange([])} className="rounded-lg px-2.5 py-1 text-[12px] text-[--muted-foreground] hover:text-[--foreground]">
              Clear
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function typesForClusters(clusters: SemanticCluster[]): KnowledgeObjectType[] {
  return clusters.flatMap((cluster) => CLUSTER_TYPES[cluster] ?? []);
}
