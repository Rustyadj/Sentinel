"use client";

import { useCallback, useMemo, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { AppShell } from "@/components/shell/AppShell";
import { EmptyState } from "@/components/shell/primitives";
import { useShellStore } from "@/store/useShellStore";
import type { SemanticCluster, TimeWindowId } from "@/lib/graph/semantics";
import type { KnowledgeNode } from "@/lib/knowledge/types";
import { OperationalLenses, type OperationalView } from "./OperationalLenses";
import { GraphCanvas } from "./GraphCanvas";
import { GraphControls, typesForClusters } from "./GraphControls";
import { GraphNodeInspector } from "./GraphNodeInspector";
import { useGraphData, type ScopedNode } from "./useGraphData";

/**
 * The Graph surface: understanding, not decoration.
 *
 * It opens on a bounded, relevant slice of the knowledge graph and grows only
 * where the operator looks — clicking a node focuses the view around it and
 * pulls in that node's neighbourhood. Nothing here loads the whole database.
 */
export function GraphSurface() {
  const { openInspector, inspector } = useShellStore();
  const [focusId, setFocusId] = useState<string | null>(null);
  const [history, setHistory] = useState<string[]>([]);
  const [clusters, setClusters] = useState<SemanticCluster[]>([]);
  const [timeWindow, setTimeWindow] = useState<TimeWindowId>("all");

  const query = useMemo(() => ({
    focusId,
    types: typesForClusters(clusters),
    timeWindow,
    limit: 120,
  }), [focusId, clusters, timeWindow]);

  const { graph: globalGraph, loading, error, expand } = useGraphData(query);
  const [operational, setOperational] = useState<OperationalView | null>(null);
  const graph = operational ?? globalGraph;

  const focusOn = useCallback((nodeId: string, label: string, type: KnowledgeNode["type"]) => {
    setHistory((current) => (focusId && focusId !== nodeId ? [...current, focusId] : current));
    setFocusId(nodeId);
    openInspector({ type: "knowledge", id: nodeId, label });
    void type;
  }, [focusId, openInspector]);

  const onSelect = useCallback((node: ScopedNode) => {
    openInspector({ type: "knowledge", id: node.id, label: node.title });
  }, [openInspector]);

  const goBack = useCallback(() => {
    setHistory((current) => {
      const previous = current[current.length - 1] ?? null;
      setFocusId(previous);
      return current.slice(0, -1);
    });
  }, []);

  const header = (
    <div className="flex items-center gap-2">
      {history.length > 0 ? (
        <button
          onClick={goBack}
          className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-(--muted-foreground) transition-colors hover:bg-(--muted) hover:text-(--foreground)"
        >
          <ArrowLeft className="h-3.5 w-3.5" /> Back
        </button>
      ) : null}
      <h1 className="font-display text-[17px] font-semibold tracking-tight">Graph</h1>
      {focusId ? (
        <button onClick={() => { setFocusId(null); setHistory([]); }} className="rounded-lg px-2 py-1.5 text-[13px] text-(--muted-foreground) hover:text-(--foreground)">
          Clear focus
        </button>
      ) : null}
    </div>
  );

  const inspectorBody = inspector?.id ? (
    <GraphNodeInspector
      nodeId={inspector.id}
      onFocus={(nodeId) => {
        const node = graph.nodes.find((entry) => entry.id === nodeId);
        focusOn(nodeId, node?.title ?? inspector.label, node?.type ?? "Note");
      }}
    />
  ) : null;

  return (
    <AppShell header={header} inspector={inspectorBody}>
      <div className="relative h-full w-full">
        <OperationalLenses onGraph={setOperational} selectedId={inspector?.id} className="absolute bottom-4 left-4" />
        <GraphControls
          activeClusters={clusters}
          onClustersChange={setClusters}
          timeWindow={timeWindow}
          onTimeWindowChange={setTimeWindow}
          onFocusNode={(node) => focusOn(node.id, node.title, node.type)}
          resultCount={graph.totalVisible}
          partial={graph.partial}
          loading={loading}
        />

        {error && !operational ? (
          <EmptyState title="The graph could not be loaded" hint={error} />
        ) : !loading && graph.nodes.length === 0 ? (
          <EmptyState
            title="Nothing to show in this view"
            hint={clusters.length || timeWindow !== "all"
              ? "No knowledge objects match the current filters."
              : "Sentinel has no readable knowledge objects yet. They appear here as agents record decisions, memories and notes."}
          />
        ) : (
          <GraphCanvas
            graph={graph}
            focusId={focusId}
            selectedId={inspector?.id ?? null}
            onSelect={onSelect}
            onExpand={operational ? () => {} : expand}
          />
        )}
      </div>
    </AppShell>
  );
}
