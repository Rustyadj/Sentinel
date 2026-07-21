"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import dynamic from "next/dynamic";
import * as THREE from "three";
import {
  SPACE_BG,
  edgeColor,
  nodeColor,
  type NeuralData,
  type NeuralLink,
  type NeuralNode,
} from "../lib/visual";

// react-force-graph-3d touches `window`/WebGL, so it must load client-only.
const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
});

export type NeuralMode = "focus" | "cluster" | "chat-hybrid";

interface NeuralGraphProps {
  data: NeuralData;
  mode: NeuralMode;
  /** Edge ids currently lit as a retrieval path (directional particles). */
  activeEdgeIds: Set<string>;
  onNodeClick?: (node: NeuralNode) => void;
  onNodeIsolate?: (node: NeuralNode) => void;
}

/** Minimal surface of the imperative force-graph handle we rely on. */
interface ForceGraphHandle {
  scene: () => THREE.Scene;
  camera: () => THREE.Camera;
  controls: () => {
    autoRotate: boolean;
    autoRotateSpeed: number;
    enabled: boolean;
    enableDamping: boolean;
  };
  cameraPosition: (
    pos: { x: number; y: number; z: number },
    lookAt?: { x: number; y: number; z: number },
    ms?: number,
  ) => void;
}

const MODE_CONFIG: Record<
  NeuralMode,
  { autoRotateSpeed: number; interactive: boolean; fogDensity: number }
> = {
  focus: { autoRotateSpeed: 0.28, interactive: true, fogDensity: 0.00055 },
  cluster: { autoRotateSpeed: 0.5, interactive: true, fogDensity: 0.0009 },
  "chat-hybrid": { autoRotateSpeed: 0.16, interactive: false, fogDensity: 0.0012 },
};

/** Soft radial sprite used as the pulse halo for active agent nodes. */
let haloTexture: THREE.Texture | null = null;
function getHaloTexture(): THREE.Texture {
  if (haloTexture) return haloTexture;
  const size = 64;
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext("2d")!;
  const grad = ctx.createRadialGradient(
    size / 2,
    size / 2,
    0,
    size / 2,
    size / 2,
    size / 2,
  );
  grad.addColorStop(0, "rgba(190, 214, 240, 0.9)");
  grad.addColorStop(0.4, "rgba(150, 180, 220, 0.35)");
  grad.addColorStop(1, "rgba(120, 150, 200, 0)");
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, size, size);
  haloTexture = new THREE.CanvasTexture(canvas);
  return haloTexture;
}

export function NeuralGraph({
  data,
  mode,
  activeEdgeIds,
  onNodeClick,
  onNodeIsolate,
}: NeuralGraphProps) {
  const fgRef = useRef<ForceGraphHandle | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const halos = useRef<Map<string, THREE.Sprite>>(new Map());
  const lastClick = useRef<{ id: string; t: number; timer: ReturnType<typeof setTimeout> | null }>(
    { id: "", t: 0, timer: null },
  );

  const config = MODE_CONFIG[mode];

  // Size to container.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => {
      setDims({ width: el.clientWidth, height: el.clientHeight });
    });
    ro.observe(el);
    setDims({ width: el.clientWidth, height: el.clientHeight });
    return () => ro.disconnect();
  }, []);

  // Depth fog + slow parallax once the graph mounts (and when mode changes).
  const handleReady = useCallback(() => {
    const fg = fgRef.current;
    if (!fg) return;
    try {
      const scene = fg.scene();
      scene.fog = new THREE.FogExp2(SPACE_BG, config.fogDensity);
      const controls = fg.controls();
      controls.autoRotate = true;
      controls.autoRotateSpeed = config.autoRotateSpeed;
      controls.enableDamping = true;
      controls.enabled = config.interactive;
    } catch {
      /* handle not ready yet */
    }
  }, [config]);

  useEffect(() => {
    // Re-apply when mode/config changes (fog density, rotation speed).
    handleReady();
  }, [handleReady]);

  // Soft pulse loop for active nodes — subtle, never a permanent glow.
  useEffect(() => {
    let raf = 0;
    const loop = () => {
      const t = performance.now() / 1000;
      const pulse = 0.5 + 0.5 * Math.sin(t * 1.8);
      for (const sprite of halos.current.values()) {
        const mat = sprite.material as THREE.SpriteMaterial;
        mat.opacity = 0.06 + pulse * 0.16;
        const s = sprite.userData.baseScale as number;
        const k = s * (0.9 + pulse * 0.35);
        sprite.scale.set(k, k, k);
      }
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, []);

  const nodeThreeObject = useCallback((node: NeuralNode) => {
    if (!node.active) return false; // default sphere
    const sprite = new THREE.Sprite(
      new THREE.SpriteMaterial({
        map: getHaloTexture(),
        color: 0xbcd4f0,
        transparent: true,
        opacity: 0.12,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      }),
    );
    const base = 6 + Math.cbrt(node.size) * 3;
    sprite.userData.baseScale = base;
    sprite.scale.set(base, base, base);
    halos.current.set(node.id, sprite);
    return sprite;
  }, []);

  const handleNodeClick = useCallback(
    (node: NeuralNode) => {
      const now = performance.now();
      const prev = lastClick.current;
      if (prev.id === node.id && now - prev.t < 320) {
        // Double-click → isolate local cluster.
        if (prev.timer) clearTimeout(prev.timer);
        lastClick.current = { id: "", t: 0, timer: null };
        onNodeIsolate?.(node);
        return;
      }
      // Single-click (deferred so a double-click can pre-empt it) → fly camera.
      const timer = setTimeout(() => {
        const fg = fgRef.current;
        if (fg && node.x != null && node.y != null && node.z != null) {
          const dist = 120;
          const len = Math.hypot(node.x, node.y, node.z) || 1;
          const ratio = 1 + dist / len;
          fg.cameraPosition(
            { x: node.x * ratio, y: node.y * ratio, z: node.z * ratio },
            { x: node.x, y: node.y, z: node.z },
            1100,
          );
        }
        onNodeClick?.(node);
      }, 260);
      lastClick.current = { id: node.id, t: now, timer };
    },
    [onNodeClick, onNodeIsolate],
  );

  const linkColor = useCallback(
    (link: NeuralLink) => edgeColor(link, activeEdgeIds.has(link.id)),
    [activeEdgeIds],
  );
  const linkParticles = useCallback(
    (link: NeuralLink) => (activeEdgeIds.has(link.id) ? 3 : 0),
    [activeEdgeIds],
  );

  const nodeLabel = useMemo(
    () =>
      (node: NeuralNode) =>
        `<div style="font:12px ui-sans-serif,system-ui;color:#e8ecf5;background:rgba(10,12,20,.82);border:1px solid rgba(150,170,210,.25);padding:3px 8px;border-radius:6px;white-space:nowrap">${escapeHtml(
          node.label,
        )}</div>`,
    [],
  );

  return (
    <div ref={containerRef} className="absolute inset-0 h-full w-full">
      {dims.width > 0 && (
        <ForceGraph3D
          ref={fgRef as never}
          width={dims.width}
          height={dims.height}
          graphData={data}
          backgroundColor={SPACE_BG}
          showNavInfo={false}
          nodeVal="size"
          nodeColor={nodeColor as never}
          nodeLabel={nodeLabel as never}
          nodeOpacity={0.92}
          nodeResolution={8}
          nodeThreeObjectExtend
          nodeThreeObject={nodeThreeObject as never}
          linkColor={linkColor as never}
          linkWidth={"width" as never}
          linkDirectionalParticles={linkParticles as never}
          linkDirectionalParticleWidth={1.4}
          linkDirectionalParticleColor={(() => "rgba(190,214,240,0.9)") as never}
          linkDirectionalParticleSpeed={0.012}
          enableNodeDrag={false}
          enableNavigationControls={config.interactive}
          cooldownTicks={mode === "chat-hybrid" ? 80 : 220}
          warmupTicks={mode === "chat-hybrid" ? 20 : 0}
          onNodeClick={handleNodeClick as never}
          onEngineStop={handleReady}
        />
      )}
    </div>
  );
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}
