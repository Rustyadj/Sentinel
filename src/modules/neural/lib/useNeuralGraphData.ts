"use client";

import { useEffect, useState } from "react";
import {
  generateKnowledgeGraph,
  type KnowledgeGraph,
} from "@/lib/knowledge-graph";

interface State {
  graph: KnowledgeGraph | null;
  loading: boolean;
  error: string | null;
}

/**
 * Fetch the canonical KnowledgeGraph from the API. On failure it falls back to
 * the same deterministic sample the server uses, so the space still renders.
 * The returned graph is treated as read-only by the renderer.
 */
export function useNeuralGraphData(): State & { reload: () => void } {
  const [state, setState] = useState<State>({
    graph: null,
    loading: true,
    error: null,
  });
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;

    void (async () => {
      try {
        const res = await fetch("/api/knowledge/graph", { cache: "no-store" });
        if (!res.ok) throw new Error(`graph ${res.status}`);
        const graph = (await res.json()) as KnowledgeGraph;
        if (!cancelled) setState({ graph, loading: false, error: null });
      } catch (err) {
        if (cancelled) return;
        console.error("[neural] graph fetch failed, using sample:", err);
        setState({
          graph: generateKnowledgeGraph(),
          loading: false,
          error: err instanceof Error ? err.message : "fetch failed",
        });
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const reload = () => {
    setState((s) => ({ ...s, loading: true }));
    setNonce((n) => n + 1);
  };

  return { ...state, reload };
}
