"use client";

import dynamic from "next/dynamic";
import * as THREE from "three";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  CONNECTED_NODE_OPACITY,
  EDGE_ACTIVE_HEX,
  EDGE_BASE_HEX,
  EDGE_LIT_HEX,
  EXECUTION_PARTICLE_COLOR,
  FADED_NODE_OPACITY,
  HUB_NODE,
  HUB_NODE_OPACITY,
  LENS_BG,
  LENS_HUB_NODE,
  NODE_RADIUS,
  PARTICLE_COLOR,
  SELECTED_NODE,
  clusterColor,
  groupColor,
  labelsVisibleAt,
  normalNodeOpacity,
  zoomLevelFor,
} from "./palette";
import type { ClusterId, ExecutionPath, LensGraph, LensNode, SemanticZoomLevel } from "./types";
import { getDotTexture, getGlowTexture } from "./sprites";

const ForceGraph3D = dynamic(() => import("react-force-graph-3d"), {
  ssr: false,
  loading: () => (
    <div className="flex h-full items-center justify-center gap-2 text-[11px] text-white/35">
      <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-sky-300" />
      Mapping neural space…
    </div>
  ),
});

interface NeuralLensGraphProps {
  graph: LensGraph;
  activeNodeIds: Set<string>;
  onSelect: (node: LensNode | null) => void;
  onZoomLevel?: (level: SemanticZoomLevel) => void;
  paused?: boolean;
  /** External focus trigger (e.g. switching the active chat agent) — same
   * camera move + lit-up neighborhood a click produces, driven from outside
   * the canvas. A ts/nonce alongside the id so re-focusing the same node
   * still retriggers the camera move. */
  focusRequest?: { nodeId: string; ts: number } | null;
  /** The cluster the active lens targets, if any. Dims everything outside it
   * without removing nodes from the graph or recomputing layout. */
  lensClusterId?: ClusterId | null;
  /** When true (and a lens is active), fully hide everything outside the
   * lens cluster, its immediate neighbors, and cross-cluster dependencies —
   * positions stay exactly where they were; nothing reflows. */
  lensOnly?: boolean;
  /** An active execution chain — only edges along this path animate. */
  executionPath?: ExecutionPath | null;
  onDoubleClickNode?: (node: LensNode) => void;
  onContextMenuNode?: (node: LensNode, screen: { x: number; y: number }) => void;
  /** Restore a previously-persisted camera position instead of the default
   * overview — see useGraphStore's cameraState. */
  initialCamera?: { position: { x: number; y: number; z: number }; lookAt: { x: number; y: number; z: number } } | null;
  /** Fired whenever the camera settles somewhere new-ish (zoom-level change,
   * or a focus animation finishing) — not every frame — so the caller can
   * persist it without hammering storage. */
  onCameraChange?: (camera: { position: { x: number; y: number; z: number }; lookAt: { x: number; y: number; z: number } }) => void;
}

type LensNode3D = LensNode & {
  z: number;
  fx: number;
  fy: number;
  fz: number;
  baseX: number;
  baseY: number;
  baseZ: number;
  driftPhase: number;
  driftScale: number;
};

function endpointId(end: unknown): string | null {
  if (typeof end === "string") return end;
  if (end && typeof end === "object" && "id" in end) {
    return String((end as { id: unknown }).id);
  }
  return null;
}

// Camera distance -> semantic-zoom "scale". Tuned against this component's
// own camera constants (initial z=1100, click-focus distance=260) so the
// five levels land where they visually should: far out reads as the galaxy,
// a focused node reads as region/neighborhood detail.
const ZOOM_REFERENCE_DISTANCE = 220;
function distanceToZoomScale(distance: number): number {
  return ZOOM_REFERENCE_DISTANCE / Math.max(distance, 1);
}

/** Cheap, shared, non-zero geometry used only for raycasting (hover/click)
 * on the bulk of nodes — their actual visuals are drawn once as a batched
 * THREE.Points field, not per-node meshes. Reused across every proxy
 * instance; only each mesh's scale/position differs. */
const HIT_PROXY_GEOMETRY = new THREE.IcosahedronGeometry(4, 0);

export function NeuralLensGraph({
  graph,
  activeNodeIds,
  onSelect,
  onZoomLevel,
  paused,
  focusRequest,
  lensClusterId = null,
  lensOnly = false,
  executionPath = null,
  onDoubleClickNode,
  onContextMenuNode,
  initialCamera = null,
  onCameraChange,
}: NeuralLensGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  // react-force-graph exposes an imperative Three.js camera surface.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const fgRef = useRef<any>(null);
  const [dims, setDims] = useState({ width: 0, height: 0 });
  const [hoveredId, setHoveredId] = useState<string | null>(null);
  // A click "focuses" a node: the camera settles nearby and its neighborhood
  // stays lit until another node/background is clicked — independent of
  // hover, which only lights the neighborhood while the pointer is over it.
  const [focusedId, setFocusedId] = useState<string | null>(null);
  const lastZoomLevel = useRef<SemanticZoomLevel | null>(null);

  const data = useMemo(() => {
    const nodes: LensNode3D[] = graph.nodes.map((node, index) => {
      const z = Math.sin(index * 1.618) * 128 + Math.cos(index * 0.371) * 44;
      return {
        ...node,
        z,
        fx: node.x,
        fy: node.y,
        fz: z,
        baseX: node.x,
        baseY: node.y,
        baseZ: z,
        driftPhase: index * 0.731,
        // Very tiny breathing motion — the brief is explicit that the graph
        // should "stabilize," not float. This is texture, not movement.
        driftScale: node.val >= 6 ? 0.6 : 0.9 + (index % 7) * 0.12,
      };
    });
    return { nodes, links: graph.links.map((link) => ({ ...link })) };
  }, [graph]);

  useEffect(() => {
    const element = containerRef.current;
    if (!element) return;
    const resizeObserver = new ResizeObserver(() => {
      setDims({ width: element.clientWidth, height: element.clientHeight });
    });
    resizeObserver.observe(element);
    setDims({ width: element.clientWidth, height: element.clientHeight });
    return () => resizeObserver.disconnect();
  }, []);

  useEffect(() => {
    if (dims.width === 0) return;
    const timer = setTimeout(() => {
      const position = initialCamera?.position ?? { x: 0, y: 0, z: 1100 };
      const lookAt = initialCamera?.lookAt ?? { x: 0, y: 0, z: 0 };
      fgRef.current?.cameraPosition?.(position, lookAt, 950);
      fgRef.current?.refresh?.();
      const distance = Math.hypot(position.x, position.y, position.z);
      const level = zoomLevelFor(distanceToZoomScale(distance));
      lastZoomLevel.current = level;
      onZoomLevel?.(level);
    }, 650);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dims.width, graph]);

  // Hover takes priority (it's the more immediate signal); a clicked focus
  // keeps lighting the same neighborhood once the pointer moves away.
  const litId = hoveredId ?? focusedId;

  const neighborIds = useMemo(() => {
    if (!litId) return null;
    const neighbors = new Set<string>([litId]);
    for (const link of graph.links) {
      if (link.source === litId) neighbors.add(link.target);
      if (link.target === litId) neighbors.add(link.source);
    }
    return neighbors;
  }, [graph.links, litId]);

  // The lit neighborhood's color follows the focused node's
  // workspace (real/SCOPED data) or hub (DEMO data, which has no real
  // workspaces) — a consistent identity color per workspace rather than a
  // single fixed highlight tint.
  const litColor = useMemo(() => {
    if (!litId) return PARTICLE_COLOR;
    const node = data.nodes.find((n) => n.id === litId);
    return groupColor(node?.workspaceId ?? node?.hubId);
  }, [data.nodes, litId]);

  // "Lens Only": cluster members plus anything directly linked to one of
  // them (immediate neighbors AND cross-cluster dependencies, in one pass —
  // a direct edge from a lens-cluster node is exactly one or the other).
  // Positions never change; this only decides what's visible.
  const lensOnlyVisibleIds = useMemo(() => {
    if (!lensOnly || !lensClusterId) return null;
    const visible = new Set<string>();
    for (const n of graph.nodes) if (n.clusterId === lensClusterId) visible.add(n.id);
    for (const link of graph.links) {
      if (visible.has(link.source)) visible.add(link.target);
      if (visible.has(link.target)) visible.add(link.source);
    }
    return visible;
  }, [lensOnly, lensClusterId, graph.nodes, graph.links]);

  const executionNodeIds = useMemo(
    () => (executionPath ? new Set(executionPath.nodeIds) : null),
    [executionPath],
  );
  const executionEdgeKeys = useMemo(() => {
    if (!executionPath) return null;
    const keys = new Set<string>();
    for (let i = 0; i < executionPath.nodeIds.length - 1; i++) {
      const a = executionPath.nodeIds[i];
      const b = executionPath.nodeIds[i + 1];
      keys.add(a < b ? `${a}|${b}` : `${b}|${a}`);
    }
    return keys;
  }, [executionPath]);

  // --- Node role classification -------------------------------------------
  // Hubs always get an individual Three object (small mesh + glow sprite)
  // and are excluded from the bulk dot field — this is structural and
  // doesn't change at runtime, so the (expensive, 5,000+ node) bulk buffer
  // only needs to be rebuilt when the graph itself changes. A non-hub node
  // becoming *selected* also gets an individual glow object (via
  // buildNodeObject below, keyed off selectedId separately), but rather than
  // rebuild the whole buffer on every click, its bulk dot is just faded to
  // 0 opacity per-frame in updateBulkAppearance so it doesn't double-render.
  const selectedId = focusedId;
  const isRareRole = useCallback((n: LensNode3D) => n.isHub === true, []);

  // --- Bulk GPU layers: one Points draw call for every ordinary node, one
  // LineSegments draw call for every edge, rebuilt only when the underlying
  // graph or the state that changes their appearance changes (not on every
  // drift tick — see the rAF loop below, which mutates the same typed
  // arrays in place instead of rebuilding geometry).
  const bulkNodesRef = useRef<{
    points: THREE.Points;
    ids: string[];
    positions: Float32Array;
    colors: Float32Array;
  } | null>(null);
  const bulkEdgesRef = useRef<{
    lines: THREE.LineSegments;
    pairs: Array<[string, string]>;
    positions: Float32Array;
    colors: Float32Array;
  } | null>(null);
  const clusterRingsRef = useRef<THREE.Group | null>(null);
  const starfieldRef = useRef<THREE.Points | null>(null);

  // Build (or rebuild) the bulk layers whenever the node/edge SET changes.
  useEffect(() => {
    const scene: THREE.Scene | undefined = fgRef.current?.scene?.();
    if (!scene || dims.width === 0) return;

    // Clean up any previous bulk objects before rebuilding.
    if (bulkNodesRef.current) scene.remove(bulkNodesRef.current.points);
    if (bulkEdgesRef.current) scene.remove(bulkEdgesRef.current.lines);
    if (clusterRingsRef.current) scene.remove(clusterRingsRef.current);
    if (starfieldRef.current) scene.remove(starfieldRef.current);

    const ordinaryNodes = data.nodes.filter((n) => !isRareRole(n));
    const positions = new Float32Array(ordinaryNodes.length * 3);
    const colors = new Float32Array(ordinaryNodes.length * 3);
    const ids = ordinaryNodes.map((n, i) => {
      positions[i * 3] = n.x;
      positions[i * 3 + 1] = n.y;
      positions[i * 3 + 2] = n.z;
      return n.id;
    });
    const nodeGeometry = new THREE.BufferGeometry();
    nodeGeometry.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    nodeGeometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    // A single uniform size for the whole dust field (mid-point of the
    // brief's 1-3px band) — one THREE.PointsMaterial draw call for every
    // ordinary node. Per-node radius variance isn't worth a custom
    // ShaderMaterial here; the opacity variance (below) already reads as
    // "slight variation" without the shader-compile risk.
    const nodeMaterial = new THREE.PointsMaterial({
      size: 2.1,
      vertexColors: true,
      map: new THREE.CanvasTexture(getDotTexture() as HTMLCanvasElement),
      transparent: true,
      depthWrite: false,
      sizeAttenuation: true,
    });
    const points = new THREE.Points(nodeGeometry, nodeMaterial);
    points.frustumCulled = false;
    scene.add(points);
    bulkNodesRef.current = { points, ids, positions, colors };

    const linkPairs: Array<[string, string]> = data.links.map((l) => [
      endpointId(l.source) ?? String(l.source),
      endpointId(l.target) ?? String(l.target),
    ]);
    const edgePositions = new Float32Array(linkPairs.length * 6);
    const edgeColors = new Float32Array(linkPairs.length * 6);
    const edgeGeometry = new THREE.BufferGeometry();
    edgeGeometry.setAttribute("position", new THREE.BufferAttribute(edgePositions, 3));
    edgeGeometry.setAttribute("color", new THREE.BufferAttribute(edgeColors, 3));
    const edgeMaterial = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false });
    const lines = new THREE.LineSegments(edgeGeometry, edgeMaterial);
    lines.frustumCulled = false;
    scene.add(lines);
    bulkEdgesRef.current = { lines, pairs: linkPairs, positions: edgePositions, colors: edgeColors };

    // Cluster outline rings — the "visible even when zoomed out" region
    // boundaries. Cheap: one LineLoop per cluster, ~10 total.
    const ringGroup = new THREE.Group();
    for (const outline of graph.clusterOutlines ?? []) {
      const segments = 64;
      const ringPositions = new Float32Array(segments * 3);
      for (let i = 0; i < segments; i++) {
        const angle = (i / segments) * Math.PI * 2;
        ringPositions[i * 3] = outline.x + Math.cos(angle) * outline.radius;
        ringPositions[i * 3 + 1] = outline.y + Math.sin(angle) * outline.radius;
        ringPositions[i * 3 + 2] = 0;
      }
      const ringGeometry = new THREE.BufferGeometry();
      ringGeometry.setAttribute("position", new THREE.BufferAttribute(ringPositions, 3));
      const color = new THREE.Color(clusterColor(outline.clusterId as ClusterId));
      const ringMaterial = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.1 });
      const ring = new THREE.LineLoop(ringGeometry, ringMaterial);
      ring.userData.clusterId = outline.clusterId;
      ring.frustumCulled = false;
      ringGroup.add(ring);
    }
    scene.add(ringGroup);
    clusterRingsRef.current = ringGroup;

    // Starfield — a large, sparse, near-static field far behind the graph.
    const starCount = 900;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const radius = 2400 + Math.random() * 3600;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3] = radius * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = radius * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = radius * Math.cos(phi) - 1500;
    }
    const starGeometry = new THREE.BufferGeometry();
    starGeometry.setAttribute("position", new THREE.BufferAttribute(starPositions, 3));
    const starMaterial = new THREE.PointsMaterial({
      size: 1.4,
      color: 0x8fa4c4,
      transparent: true,
      opacity: 0.35,
      sizeAttenuation: true,
      map: new THREE.CanvasTexture(getDotTexture() as HTMLCanvasElement),
      depthWrite: false,
    });
    const starfield = new THREE.Points(starGeometry, starMaterial);
    starfield.frustumCulled = false;
    scene.add(starfield);
    starfieldRef.current = starfield;

    return () => {
      scene.remove(points);
      scene.remove(lines);
      scene.remove(ringGroup);
      scene.remove(starfield);
      nodeGeometry.dispose();
      nodeMaterial.dispose();
      edgeGeometry.dispose();
      edgeMaterial.dispose();
      starGeometry.dispose();
      starMaterial.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, dims.width]);

  // --- Per-frame appearance update -----------------------------------------
  // Runs inside the existing drift loop below: writes fresh position/color
  // into the SAME typed arrays (no allocation, no geometry rebuild) so it
  // stays cheap even at thousands of nodes / tens of thousands of edges.
  const updateBulkAppearance = useCallback(() => {
    const bulkNodes = bulkNodesRef.current;
    const bulkEdges = bulkEdgesRef.current;
    if (!bulkNodes && !bulkEdges) return;

    const byId = new Map(data.nodes.map((n) => [n.id, n]));
    const dimColor = new THREE.Color("#7f92ac");
    const scratch = new THREE.Color();

    const opacityFor = (n: LensNode3D): number => {
      // Already rendered as an individual glow object — don't double-draw.
      if (n.id === selectedId) return 0;
      if (lensOnlyVisibleIds && !lensOnlyVisibleIds.has(n.id)) return 0;
      if (executionNodeIds && executionNodeIds.size > 0) {
        return executionNodeIds.has(n.id) ? 1 : FADED_NODE_OPACITY;
      }
      if (neighborIds) return neighborIds.has(n.id) ? CONNECTED_NODE_OPACITY : FADED_NODE_OPACITY;
      if (activeNodeIds.has(n.id)) return CONNECTED_NODE_OPACITY;
      const base = normalNodeOpacity(n.id);
      if (lensClusterId && n.clusterId !== lensClusterId) return base * 0.35;
      return base;
    };

    if (bulkNodes) {
      for (let i = 0; i < bulkNodes.ids.length; i++) {
        const n = byId.get(bulkNodes.ids[i]);
        if (!n) continue;
        bulkNodes.positions[i * 3] = n.x;
        bulkNodes.positions[i * 3 + 1] = n.y;
        bulkNodes.positions[i * 3 + 2] = n.z;

        const opacity = opacityFor(n);
        if (neighborIds && litId && neighborIds.has(n.id)) {
          scratch.set(litColor);
        } else {
          scratch.copy(dimColor);
        }
        scratch.multiplyScalar(opacity);
        bulkNodes.colors[i * 3] = scratch.r;
        bulkNodes.colors[i * 3 + 1] = scratch.g;
        bulkNodes.colors[i * 3 + 2] = scratch.b;
      }
      bulkNodes.points.geometry.attributes.position.needsUpdate = true;
      bulkNodes.points.geometry.attributes.color.needsUpdate = true;
    }

    if (bulkEdges) {
      const baseColor = new THREE.Color(EDGE_BASE_HEX);
      const litEdgeColor = new THREE.Color(EDGE_LIT_HEX);
      const activeEdgeColor = new THREE.Color(EDGE_ACTIVE_HEX);
      for (let i = 0; i < bulkEdges.pairs.length; i++) {
        const [a, b] = bulkEdges.pairs[i];
        const na = byId.get(a);
        const nb = byId.get(b);
        if (!na || !nb) continue;
        bulkEdges.positions[i * 6] = na.x;
        bulkEdges.positions[i * 6 + 1] = na.y;
        bulkEdges.positions[i * 6 + 2] = na.z;
        bulkEdges.positions[i * 6 + 3] = nb.x;
        bulkEdges.positions[i * 6 + 4] = nb.y;
        bulkEdges.positions[i * 6 + 5] = nb.z;

        const key = a < b ? `${a}|${b}` : `${b}|${a}`;
        let opacity = 0.05;
        let color = baseColor;
        if (executionEdgeKeys?.has(key)) {
          // Only the active execution path animates — everything else stays
          // exactly as it already was (per the brief: "never animate the
          // entire graph").
          opacity = 0.9;
          color = activeEdgeColor;
        } else if (lensOnlyVisibleIds && (!lensOnlyVisibleIds.has(a) || !lensOnlyVisibleIds.has(b))) {
          opacity = 0;
        } else if (litId && (a === litId || b === litId)) {
          // Touches the hovered/focused node directly — full highlight.
          opacity = 0.5;
          color = litEdgeColor;
        } else if (lensClusterId && na.clusterId !== lensClusterId && nb.clusterId !== lensClusterId) {
          opacity = 0.015;
        }

        scratch.copy(color).multiplyScalar(opacity);
        bulkEdges.colors[i * 6] = scratch.r;
        bulkEdges.colors[i * 6 + 1] = scratch.g;
        bulkEdges.colors[i * 6 + 2] = scratch.b;
        bulkEdges.colors[i * 6 + 3] = scratch.r;
        bulkEdges.colors[i * 6 + 4] = scratch.g;
        bulkEdges.colors[i * 6 + 5] = scratch.b;
      }
      bulkEdges.lines.geometry.attributes.position.needsUpdate = true;
      bulkEdges.lines.geometry.attributes.color.needsUpdate = true;
    }
  }, [data.nodes, neighborIds, litId, litColor, activeNodeIds, lensClusterId, lensOnlyVisibleIds, executionNodeIds, executionEdgeKeys, selectedId]);

  // Cluster ring opacity fades in as the camera pulls out — legible at
  // galaxy/cluster zoom, unobtrusive once you're in close.
  const updateClusterRings = useCallback((zoomScale: number) => {
    const group = clusterRingsRef.current;
    if (!group) return;
    const ringOpacity = zoomScale < 0.55 ? 0.16 : zoomScale < 1.1 ? 0.08 : 0.02;
    for (const child of group.children) {
      const ring = child as THREE.LineLoop;
      const material = ring.material as THREE.LineBasicMaterial;
      const isActiveLens = lensClusterId && ring.userData.clusterId === lensClusterId;
      // Deliberate imperative Three.js mutation — clusterRingsRef holds a
      // live scene-graph object we update in place every frame, the same
      // pattern used throughout this file's rAF loop (node.fx/.fy/.fz, etc).
      // eslint-disable-next-line react-hooks/immutability
      material.opacity = isActiveLens ? Math.max(ringOpacity, 0.3) : ringOpacity;
    }
  }, [lensClusterId]);

  // Independent, very slow offsets keep the network alive without turning the
  // entire structure into a rigid orbit. Motion stops for reduced-motion users.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    let frame = 0;
    let last = performance.now();
    const loop = (now: number) => {
      if (document.visibilityState === "visible" && now - last >= 70) {
        last = now;
        if (!paused && !reducedMotion) {
          const seconds = now / 1000;
          for (const node of data.nodes) {
            const phase = node.driftPhase;
            const scale = node.driftScale;
            node.fx = node.baseX + Math.sin(seconds * 0.13 + phase) * scale;
            node.fy = node.baseY + Math.cos(seconds * 0.11 + phase * 1.13) * scale;
            node.fz = node.baseZ + Math.sin(seconds * 0.09 + phase * 1.43) * scale * 0.6;
            node.x = node.fx;
            node.y = node.fy;
            node.z = node.fz;
          }
        }
        updateBulkAppearance();

        const camera = fgRef.current?.camera?.();
        if (camera) {
          const distance = Math.hypot(camera.position.x, camera.position.y, camera.position.z);
          const scale = distanceToZoomScale(distance);
          updateClusterRings(scale);
          const level = zoomLevelFor(scale);
          if (level !== lastZoomLevel.current) {
            lastZoomLevel.current = level;
            onZoomLevel?.(level);
            const controlsTarget = fgRef.current?.controls?.()?.target;
            onCameraChange?.({
              position: { x: camera.position.x, y: camera.position.y, z: camera.position.z },
              lookAt: controlsTarget
                ? { x: controlsTarget.x, y: controlsTarget.y, z: controlsTarget.z }
                : { x: 0, y: 0, z: 0 },
            });
          }
          if (starfieldRef.current) {
            starfieldRef.current.rotation.y = (now / 1000) * 0.0015;
          }
        }

        fgRef.current?.refresh?.();
      }
      frame = requestAnimationFrame(loop);
    };
    frame = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frame);
  }, [data.nodes, paused, updateBulkAppearance, updateClusterRings, onZoomLevel, onCameraChange]);

  // Distance the camera settles at after a click — a moderate, consistent
  // pull-in rather than diving all the way to the node's surface.
  const FOCUS_DISTANCE = 260;

  // "Square up" on a node: keep the camera's current viewing direction
  // (whatever angle the user was already looking from) and pull in to a
  // fixed, moderate distance from the node along that same line — a slight
  // zoom that frames the node face-on, rather than recomputing an angle from
  // the origin and diving all the way in. Shared by click-to-focus and any
  // external focus trigger (e.g. switching the active chat agent).
  const focusOnNode = useCallback((selected: LensNode3D) => {
    const camera = fgRef.current?.camera?.();
    const current = camera?.position ?? { x: 0, y: 0, z: 1100 };
    const dx = current.x - selected.x;
    const dy = current.y - selected.y;
    const dz = current.z - selected.z;
    const distance = Math.hypot(dx, dy, dz) || 1;
    const scale = FOCUS_DISTANCE / distance;
    const nextPosition = {
      x: selected.x + dx * scale,
      y: selected.y + dy * scale,
      z: selected.z + dz * scale,
    };
    const nextLookAt = { x: selected.x, y: selected.y, z: selected.z };
    fgRef.current?.cameraPosition?.(nextPosition, nextLookAt, 850);
    window.setTimeout(() => onCameraChange?.({ position: nextPosition, lookAt: nextLookAt }), 900);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleClick = useCallback(
    (node: object) => {
      const selected = node as LensNode3D;
      onSelect(selected);
      setFocusedId(selected.id);
      focusOnNode(selected);
    },
    [onSelect, focusOnNode],
  );

  // External focus trigger — same effect as a click, without requiring one.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    if (!focusRequest) return;
    const node = data.nodes.find((n) => n.id === focusRequest.nodeId);
    if (!node) return;
    onSelect(node);
    setFocusedId(node.id);
    focusOnNode(node);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Keyboard navigation: arrow keys step through the selected node's direct
  // neighbors (deterministic order — by id — so repeated presses are
  // predictable); Escape clears the selection. Only active while the canvas
  // itself has focus, so it doesn't hijack keys meant for the rest of the page.
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      if (event.key === "Escape") {
        onSelect(null);
        setFocusedId(null);
        return;
      }

      const isNext = event.key === "ArrowRight" || event.key === "ArrowDown";
      const isPrev = event.key === "ArrowLeft" || event.key === "ArrowUp";
      if (!isNext && !isPrev) return;
      event.preventDefault();

      const current = data.nodes.find((n) => n.id === selectedId);
      if (!current) {
        // Nothing selected yet — start at the first hub so arrow keys are
        // useful even before a click.
        const firstHub = data.nodes.find((n) => n.isHub);
        if (firstHub) {
          onSelect(firstHub);
          setFocusedId(firstHub.id);
          focusOnNode(firstHub);
        }
        return;
      }

      const neighbors = [...new Set(
        graph.links
          .filter((l) => l.source === current.id || l.target === current.id)
          .map((l) => (l.source === current.id ? l.target : l.source)),
      )].sort();
      if (neighbors.length === 0) return;

      const currentIndex = neighbors.indexOf(hoveredId ?? neighbors[0]);
      const startIndex = currentIndex === -1 ? 0 : currentIndex;
      const nextIndex = isNext
        ? (startIndex + 1) % neighbors.length
        : (startIndex - 1 + neighbors.length) % neighbors.length;
      const nextNode = data.nodes.find((n) => n.id === neighbors[nextIndex]);
      if (nextNode) {
        onSelect(nextNode);
        setFocusedId(nextNode.id);
        focusOnNode(nextNode);
      }
    },
    [data.nodes, graph.links, selectedId, hoveredId, onSelect, focusOnNode],
  );

  // Individual Three objects for the rare roles (hub / lens hub / selected)
  // — a small sphere plus an additive glow sprite. Everyone else gets a
  // cheap, invisible-but-raycastable proxy so hover/click still work while
  // their actual pixels come from the bulk Points layer above.
  const buildNodeObject = useCallback(
    (node: object) => {
      const n = node as LensNode3D;
      const isSelected = n.id === selectedId;
      const isLensHub = n.isHub && lensClusterId !== null && n.clusterId === lensClusterId;

      if (!isSelected && !n.isHub) {
        const material = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0, depthWrite: false });
        const mesh = new THREE.Mesh(HIT_PROXY_GEOMETRY, material);
        mesh.scale.setScalar(0.6);
        return mesh;
      }

      const group = new THREE.Group();
      const color = isSelected ? SELECTED_NODE : isLensHub ? LENS_HUB_NODE : HUB_NODE;
      const radius = isSelected ? NODE_RADIUS.selected : isLensHub ? NODE_RADIUS.lensHub : NODE_RADIUS.hub;

      const sphereGeometry = new THREE.SphereGeometry(radius, 12, 8);
      const sphereMaterial = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: isSelected ? 1 : HUB_NODE_OPACITY,
      });
      group.add(new THREE.Mesh(sphereGeometry, sphereMaterial));

      const glowMaterial = new THREE.SpriteMaterial({
        map: new THREE.CanvasTexture(getGlowTexture() as HTMLCanvasElement),
        color,
        transparent: true,
        depthWrite: false,
        blending: THREE.AdditiveBlending,
      });
      const glow = new THREE.Sprite(glowMaterial);
      glow.scale.setScalar(radius * (isSelected ? 6 : 4.5));
      group.add(glow);

      if (isSelected) {
        const ringGeometry = new THREE.RingGeometry(radius * 1.5, radius * 1.7, 32);
        const ringMaterial = new THREE.MeshBasicMaterial({ color: SELECTED_NODE, transparent: true, opacity: 0.85, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeometry, ringMaterial);
        group.add(ring);
      }

      return group;
    },
    [selectedId, lensClusterId],
  );

  return (
    <div
      ref={containerRef}
      className="neural-space-canvas absolute inset-0 h-full w-full overflow-hidden"
      role="application"
      aria-label="Knowledge graph canvas"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      {dims.width > 0 && (
        <ForceGraph3D
          ref={fgRef}
          width={dims.width}
          height={dims.height}
          graphData={data}
          backgroundColor={LENS_BG}
          showNavInfo={false}
          controlType="orbit"
          numDimensions={3}
          nodeLabel={(node: object) => {
            const typed = node as LensNode3D;
            const level = lastZoomLevel.current ?? "galaxy";
            if (typed.id === selectedId) return typed.label;
            return labelsVisibleAt(level, !!typed.isHub) ? typed.label : "";
          }}
          nodeThreeObject={buildNodeObject}
          nodeThreeObjectExtend={false}
          linkOpacity={0}
          linkWidth={0}
          linkCurvature={() => 0}
          linkDirectionalParticles={(link: object) => {
            const typed = link as { source: unknown; target: unknown };
            const source = endpointId(typed.source);
            const target = endpointId(typed.target);
            if (!source || !target) return 0;
            const key = source < target ? `${source}|${target}` : `${target}|${source}`;
            if (executionEdgeKeys?.has(key)) return 2;
            return activeNodeIds.size > 0 && (activeNodeIds.has(source) || activeNodeIds.has(target)) ? 1 : 0;
          }}
          linkDirectionalParticleWidth={(link: object) => {
            const typed = link as { source: unknown; target: unknown };
            const source = endpointId(typed.source);
            const target = endpointId(typed.target);
            if (source && target) {
              const key = source < target ? `${source}|${target}` : `${target}|${source}`;
              if (executionEdgeKeys?.has(key)) return 1.6;
            }
            return 0.75;
          }}
          linkDirectionalParticleColor={(link: object) => {
            const typed = link as { source: unknown; target: unknown };
            const source = endpointId(typed.source);
            const target = endpointId(typed.target);
            if (source && target) {
              const key = source < target ? `${source}|${target}` : `${target}|${source}`;
              if (executionEdgeKeys?.has(key)) return EXECUTION_PARTICLE_COLOR;
            }
            return PARTICLE_COLOR;
          }}
          linkDirectionalParticleSpeed={(link: object) => {
            const typed = link as { source: unknown; target: unknown };
            const source = endpointId(typed.source);
            const target = endpointId(typed.target);
            if (source && target) {
              const key = source < target ? `${source}|${target}` : `${target}|${source}`;
              if (executionEdgeKeys?.has(key)) return 0.006;
            }
            return 0.0018;
          }}
          enableNodeDrag
          enableNavigationControls
          enablePointerInteraction
          warmupTicks={1}
          cooldownTicks={1}
          onNodeHover={(node: object | null) => setHoveredId((node as LensNode | null)?.id ?? null)}
          onNodeClick={handleClick}
          onNodeRightClick={(node: object, event: MouseEvent) => {
            onContextMenuNode?.(node as LensNode, { x: event.clientX, y: event.clientY });
          }}
          {...(onDoubleClickNode ? { onNodeDoubleClick: (node: object) => onDoubleClickNode(node as LensNode) } : {})}
          onNodeDragEnd={(node: object) => {
            const typed = node as LensNode3D;
            typed.baseX = typed.x;
            typed.baseY = typed.y;
            typed.baseZ = typed.z;
          }}
          onBackgroundClick={() => {
            onSelect(null);
            setFocusedId(null);
          }}
        />
      )}
    </div>
  );
}
