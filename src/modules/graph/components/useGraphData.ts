"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { KnowledgeEdge, KnowledgeNode, KnowledgeObjectType } from "@/lib/knowledge/types";
import { windowCutoff, type TimeWindowId } from "@/lib/graph/semantics";

export type ScopedNode = KnowledgeNode & { degree: number; truncatedDegree: number };

export interface ScopedGraph {
  nodes: ScopedNode[];
  edges: KnowledgeEdge[];
  focusId: string | null;
  partial: boolean;
  totalVisible: number;
}

const EMPTY: ScopedGraph = { nodes: [], edges: [], focusId: null, partial: false, totalVisible: 0 };

export interface GraphQuery {
  focusId: string | null;
  types: KnowledgeObjectType[];
  timeWindow: TimeWindowId;
  limit: number;
}

/**
 * Scoped graph loading with progressive expansion.
 *
 * The initial read is a bounded entry set. Expanding a node fetches only that
 * node's neighbourhood and merges it into what is already on screen, so the
 * client never holds more than the operator has actually explored.
 */
export function useGraphData(query: GraphQuery) {
  const [graph, setGraph] = useState<ScopedGraph>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanding, setExpanding] = useState<string | null>(null);
  const controllerRef = useRef<AbortController | null>(null);

  const buildParams = useCallback((focusId: string | null, depth: number) => {
    const params = new URLSearchParams({ limit: String(query.limit), depth: String(depth) });
    if (focusId) params.set("focus", focusId);
    if (query.types.length) params.set("types", query.types.join(","));
    const cutoff = windowCutoff(query.timeWindow);
    if (cutoff) params.set("since", cutoff.toISOString());
    return params;
  }, [query.limit, query.types, query.timeWindow]);

  useEffect(() => {
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    let active = true;

    void (async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/graph/scoped?${buildParams(query.focusId, 1)}`, { signal: controller.signal });
        const body = await response.json();
        if (!active) return;
        if (!response.ok) {
          setError(body.error ?? "The graph could not be loaded.");
          setGraph(EMPTY);
        } else {
          setError(null);
          setGraph(body as ScopedGraph);
        }
      } catch (caught) {
        if (!active || controller.signal.aborted) return;
        setError(caught instanceof Error ? caught.message : "The graph could not be loaded.");
        setGraph(EMPTY);
      } finally {
        if (active) setLoading(false);
      }
    })();

    return () => { active = false; controller.abort(); };
  }, [buildParams, query.focusId]);

  /** Pull in one node's neighbours without discarding the current view. */
  const expand = useCallback(async (nodeId: string) => {
    setExpanding(nodeId);
    try {
      const response = await fetch(`/api/graph/scoped?${buildParams(nodeId, 1)}`);
      if (!response.ok) return;
      const addition = (await response.json()) as ScopedGraph;
      setGraph((current) => {
        const nodes = new Map(current.nodes.map((node) => [node.id, node]));
        for (const node of addition.nodes) nodes.set(node.id, node);
        const edges = new Map(current.edges.map((edge) => [edge.id, edge]));
        for (const edge of addition.edges) edges.set(edge.id, edge);
        const nodeList = [...nodes.values()];
        return {
          nodes: nodeList,
          edges: [...edges.values()],
          focusId: current.focusId,
          partial: current.partial || addition.partial,
          totalVisible: nodeList.length,
        };
      });
    } finally {
      setExpanding(null);
    }
  }, [buildParams]);

  return { graph, loading, error, expand, expanding };
}
