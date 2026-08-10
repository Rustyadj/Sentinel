"use client";

import { useEffect, useRef } from "react";
import { clusterColor } from "./palette";
import type { LensGraph } from "./types";
import type { GlobeScene } from "./globe/GlobeScene";

const WIDTH = 186;
const HEIGHT = 112;
const MARKER_INTERVAL_MS = 120;

/**
 * Graph map: the whole globe seen head-on, with a reticle showing where the
 * camera is currently looking and how tight the framing is.
 *
 * The node field is drawn once to an offscreen canvas (it never changes — the
 * layout is fixed), so the per-frame work is one blit plus a reticle. The view
 * is deliberately a fixed head-on projection rather than following the
 * camera's rotation: it's an overview, and an overview that spins with you
 * stops being one.
 */
export function GraphMinimap({ graph, scene }: { graph: LensGraph; scene: GlobeScene | null }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const baseRef = useRef<HTMLCanvasElement | null>(null);
  const scaleRef = useRef({ scale: 1, offsetX: 0, offsetY: 0 });

  useEffect(() => {
    if (graph.nodes.length === 0) return;
    const base = document.createElement("canvas");
    base.width = WIDTH;
    base.height = HEIGHT;
    const ctx = base.getContext("2d");
    if (!ctx) return;

    let extent = 1;
    for (const node of graph.nodes) {
      extent = Math.max(extent, Math.abs(node.x), Math.abs(node.y));
    }
    const padding = 8;
    const scale = Math.min((WIDTH - padding * 2) / (extent * 2), (HEIGHT - padding * 2) / (extent * 2));
    const offsetX = WIDTH / 2;
    const offsetY = HEIGHT / 2;
    scaleRef.current = { scale, offsetX, offsetY };

    // Sorting back-to-front means the near hemisphere lands on top, which is
    // what makes a flat scatter of dots read as a sphere at this size.
    const ordered = [...graph.nodes].sort((a, b) => a.z - b.z);
    for (const node of ordered) {
      const depth = (node.z / extent + 1) / 2;
      ctx.globalAlpha = 0.1 + depth * 0.32;
      ctx.fillStyle = clusterColor(node.clusterId);
      const radius = node.isHub ? 1.4 : 0.55;
      ctx.beginPath();
      ctx.arc(offsetX + node.x * scale, offsetY - node.y * scale, radius, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
    baseRef.current = base;
  }, [graph]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !scene) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    let last = 0;

    return scene.addFrameListener((api) => {
      const now = performance.now();
      if (now - last < MARKER_INTERVAL_MS) return;
      last = now;

      ctx.clearRect(0, 0, WIDTH, HEIGHT);
      const base = baseRef.current;
      if (base) ctx.drawImage(base, 0, 0);

      const { scale, offsetX, offsetY } = scaleRef.current;
      const target = scene.getCameraState().lookAt;
      // Closer camera ⇒ tighter reticle. Clamped so it stays visible at both
      // ends of the zoom range.
      const span = Math.max(14, Math.min(WIDTH, (api.cameraDistance * scale) / 2.6));
      const x = offsetX + target.x * scale;
      const y = offsetY - target.y * scale;

      ctx.strokeStyle = "rgba(167, 139, 250, 0.75)";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - span / 2, y - (span * HEIGHT) / WIDTH / 2, span, (span * HEIGHT) / WIDTH);
    });
  }, [scene]);

  return (
    <div className="overflow-hidden rounded border border-white/[0.07] bg-[#04070d]">
      <canvas
        ref={canvasRef}
        width={WIDTH}
        height={HEIGHT}
        className="block h-auto w-full"
        role="img"
        aria-label="Graph overview map"
      />
    </div>
  );
}
