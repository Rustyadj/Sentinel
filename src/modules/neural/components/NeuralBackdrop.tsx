"use client";

import { useMemo } from "react";
import { buildNeuralData, selectVisible } from "../lib/visual";
import { useNeuralGraphData } from "../lib/useNeuralGraphData";
import { NeuralGraph } from "./NeuralGraph";

/** Ambient node cap for the chat-hybrid backdrop — kept low and calm. */
const HYBRID_CAP = 150;

/**
 * Chat Hybrid mode: a simplified, non-interactive 2.5D slice of the neural
 * space drifting behind the chat. Pointer-events are disabled and opacity is
 * low so it reads as atmosphere, never competing with the conversation.
 */
export function NeuralBackdrop() {
  const { graph, loading } = useNeuralGraphData();

  const data = useMemo(() => {
    if (!graph) return null;
    return buildNeuralData(selectVisible(graph, HYBRID_CAP));
  }, [graph]);

  if (loading || !data || data.nodes.length === 0) return null;

  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 z-0 opacity-40"
    >
      <NeuralGraph data={data} mode="chat-hybrid" activeEdgeIds={EMPTY} />
    </div>
  );
}

const EMPTY: Set<string> = new Set();
