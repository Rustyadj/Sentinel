"use client";

import { useEffect, useRef } from "react";
import { nodeColor } from "./palette";
import type { LensGraph } from "./types";

/**
 * Static overview minimap — plots every node's layout position so the viewer
 * keeps a sense of the whole constellation while zoomed in. Uses the fixed
 * layout coordinates (pre-rotation), which is sufficient for an overview.
 */
export function NeuralLensMinimap({ graph }: { graph: LensGraph }) {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    ctx.clearRect(0, 0, W, H);

    if (graph.nodes.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const n of graph.nodes) {
      minX = Math.min(minX, n.x);
      maxX = Math.max(maxX, n.x);
      minY = Math.min(minY, n.y);
      maxY = Math.max(maxY, n.y);
    }
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const pad = 6;
    const scale = Math.min((W - pad * 2) / spanX, (H - pad * 2) / spanY);

    for (const n of graph.nodes) {
      const x = pad + (n.x - minX) * scale;
      const y = pad + (n.y - minY) * scale;
      ctx.beginPath();
      ctx.arc(x, y, n.val >= 6 ? 1.6 : 0.7, 0, Math.PI * 2);
      ctx.fillStyle = nodeColor(n.type, !!n.accent, n.val >= 6);
      ctx.globalAlpha = n.val >= 6 ? 0.95 : 0.55;
      ctx.fill();
    }
  }, [graph]);

  return (
    <div className="pointer-events-none absolute bottom-12 right-4 z-20 hidden overflow-hidden rounded-lg border border-white/10 bg-[#050a12]/85 shadow-2xl backdrop-blur-xl md:block">
      <canvas ref={ref} width={180} height={120} className="block" />
    </div>
  );
}
