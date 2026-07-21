"use client";

import { useEffect, useMemo, useState } from "react";
import type { NeuralData, NeuralLink } from "./visual";

const EMPTY: Set<string> = new Set();

function endId(end: string | { id: string }): string {
  return typeof end === "string" ? end : end.id;
}

/**
 * Periodically lights up a short retrieval path through the graph — the visual
 * echo of an agent pulling context. Returns the set of edge ids currently
 * active; the renderer draws directional particles along them. Purely cosmetic
 * and derived from the render data — it holds no canonical state.
 */
export function useRetrievalPaths(
  data: NeuralData,
  enabled: boolean,
): Set<string> {
  const [activeEdges, setActiveEdges] = useState<Set<string>>(EMPTY);

  // Adjacency over the current links, keyed by node id → outgoing links.
  const adjacency = useMemo(() => {
    const map = new Map<string, NeuralLink[]>();
    for (const l of data.links) {
      const s = endId(l.source);
      if (!map.has(s)) map.set(s, []);
      map.get(s)!.push(l);
    }
    return map;
  }, [data.links]);

  const seeds = useMemo(
    () =>
      data.nodes
        .filter((n) => n.active || n.degree >= 4)
        .map((n) => n.id),
    [data.nodes],
  );

  useEffect(() => {
    // When disabled, no subscription runs and the hook returns EMPTY (below),
    // so we never call setState synchronously during the effect body.
    if (!enabled || seeds.length === 0) return;

    let clearTimer: ReturnType<typeof setTimeout> | null = null;

    const tick = () => {
      const start = seeds[Math.floor(Math.random() * seeds.length)];
      const path = new Set<string>();
      let current = start;
      const hops = 3 + Math.floor(Math.random() * 3);
      for (let i = 0; i < hops; i++) {
        const out = adjacency.get(current);
        if (!out || out.length === 0) break;
        const link = out[Math.floor(Math.random() * out.length)];
        path.add(link.id);
        current = endId(link.target);
      }
      if (path.size > 0) {
        setActiveEdges(path);
        clearTimer = setTimeout(() => setActiveEdges(EMPTY), 1800);
      }
    };

    tick();
    const interval = setInterval(tick, 2600);
    return () => {
      clearInterval(interval);
      if (clearTimer) clearTimeout(clearTimer);
      setActiveEdges(EMPTY);
    };
  }, [enabled, seeds, adjacency]);

  return enabled ? activeEdges : EMPTY;
}
