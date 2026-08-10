"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { groupColor } from "./palette";
import type { ClusterId, ExecutionPath, LensGraph, LensNode, SemanticZoomLevel } from "./types";
import { GlobeScene, type GlobeCameraState } from "./globe/GlobeScene";
import { DEFAULT_GLOBE_SETTINGS, type GlobeSettings } from "./graphSettings";
import { GlobeOverlay } from "./globe/GlobeOverlay";

/** Imperative handle the surrounding chrome drives (zoom buttons, reset,
 * search-to-focus) without owning the camera itself. */
export interface GlobeGraphApi {
  resetView: () => void;
  zoomBy: (factor: number) => void;
  focusNode: (id: string) => void;
  focusRegion: (clusterId: ClusterId) => void;
}

interface NeuralLensGraphProps {
  graph: LensGraph;
  /** Nodes lit by live events or pinned by the shell (active chat agents). */
  activeNodeIds: Set<string>;
  /** Controlled selection — the canvas and the panels read the same value. */
  selectedId: string | null;
  onSelect: (node: LensNode | null) => void;
  onZoomLevel?: (level: SemanticZoomLevel) => void;
  paused?: boolean;
  /** External focus trigger (e.g. switching the active chat agent) — the same
   * camera move a click produces, driven from outside the canvas. The ts acts
   * as a nonce so re-focusing the same node still retriggers the move. */
  focusRequest?: { nodeId: string; ts: number } | null;
  /** The cluster the active lens targets. Emphasises it and dims the rest —
   * it never removes nodes or recomputes layout. */
  lensClusterId?: ClusterId | null;
  /** Lens Only: additionally hide everything outside the lens cluster and its
   * direct dependencies. Positions stay exactly where they were. */
  lensOnly?: boolean;
  /** An active execution chain — only edges along this route animate. */
  executionPath?: ExecutionPath | null;
  settings?: GlobeSettings;
  /** Increment to snap the camera back to the default framing. */
  resetSignal?: number;
  initialCamera?: GlobeCameraState | null;
  /** Fired when the camera settles somewhere new, not every frame. */
  onCameraChange?: (camera: GlobeCameraState) => void;
  onDoubleClickNode?: (node: LensNode) => void;
  onContextMenuNode?: (node: LensNode, screen: { x: number; y: number }) => void;
  /** Clicking a region name on the globe switches the lens to it. */
  onLensChange?: (clusterId: ClusterId | null) => void;
  /** Handed the live scene so sibling chrome (the graph map) can read the
   * camera without going through React state every frame. */
  onSceneReady?: (scene: GlobeScene | null) => void;
  apiRef?: React.RefObject<GlobeGraphApi | null>;
}

const HOVER_THROTTLE_MS = 40;
const CLICK_SLOP_PX = 4;

export function NeuralLensGraph({
  graph,
  activeNodeIds,
  selectedId,
  onSelect,
  onZoomLevel,
  paused = false,
  focusRequest,
  lensClusterId = null,
  lensOnly = false,
  executionPath = null,
  settings = DEFAULT_GLOBE_SETTINGS,
  resetSignal = 0,
  initialCamera = null,
  onCameraChange,
  onDoubleClickNode,
  onContextMenuNode,
  onLensChange,
  onSceneReady,
  apiRef,
}: NeuralLensGraphProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const sceneRef = useRef<GlobeScene | null>(null);
  const [scene, setScene] = useState<GlobeScene | null>(null);
  const [renderError, setRenderError] = useState<string | null>(null);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const nodesById = useMemo(() => new Map(graph.nodes.map((node) => [node.id, node])), [graph.nodes]);
  const selectedNode = selectedId ? nodesById.get(selectedId) ?? null : null;
  const hoveredNode = hoveredId ? nodesById.get(hoveredId) ?? null : null;

  // Callbacks are read through a ref so the scene is created exactly once and
  // never torn down because a parent re-rendered with a new closure.
  const callbacks = useRef({ onZoomLevel, onCameraChange, onSceneReady });
  useEffect(() => {
    callbacks.current = { onZoomLevel, onCameraChange, onSceneReady };
  }, [onZoomLevel, onCameraChange, onSceneReady]);

  // Creating the scene is a one-shot mount side effect, and both of its
  // outcomes (a live scene, or a WebGL failure to report) have to land in
  // state for the render below to react to them.
  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    let instance: GlobeScene;
    try {
      instance = new GlobeScene(container, {
        onZoomLevel: (level) => callbacks.current.onZoomLevel?.(level),
        onCameraSettled: (camera) => callbacks.current.onCameraChange?.(camera),
      });
    } catch (error) {
      // No WebGL (blocked, software-rendering disabled, context exhausted).
      // Surface it instead of leaving an empty black rectangle.
      setRenderError(error instanceof Error ? error.message : "WebGL is unavailable in this browser");
      return;
    }

    sceneRef.current = instance;
    setScene(instance);
    callbacks.current.onSceneReady?.(instance);
    instance.start();

    const observer = new ResizeObserver(() => instance.resize());
    observer.observe(container);

    return () => {
      observer.disconnect();
      instance.dispose();
      sceneRef.current = null;
      setScene(null);
      callbacks.current.onSceneReady?.(null);
    };
  }, []);
  /* eslint-enable react-hooks/set-state-in-effect */

  // Graph swaps (DEMO ↔ SCOPED, live refresh) rebuild the buffers but leave
  // the camera alone — the operator's viewpoint is theirs, not the data's.
  const restoredCamera = useRef(false);
  useEffect(() => {
    const instance = sceneRef.current;
    if (!instance) return;
    instance.setGraph(graph);
    if (!restoredCamera.current) {
      restoredCamera.current = true;
      if (!instance.restoreCamera(initialCamera)) instance.resetView(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [graph, scene]);

  const litIds = useMemo(() => activeNodeIds, [activeNodeIds]);
  const litColor = useMemo(() => {
    const node = selectedNode ?? hoveredNode;
    return groupColor(node?.workspaceId ?? node?.hubId);
  }, [selectedNode, hoveredNode]);
  const pathNodeIds = useMemo(() => executionPath?.nodeIds ?? null, [executionPath]);

  useEffect(() => {
    sceneRef.current?.setState({
      selectedId,
      hoveredId,
      litIds,
      litColor,
      lensClusterId,
      lensOnly,
      pathNodeIds,
      settings,
    });
  }, [scene, selectedId, hoveredId, litIds, litColor, lensClusterId, lensOnly, pathNodeIds, settings]);

  useEffect(() => {
    if (paused) sceneRef.current?.stop();
    else sceneRef.current?.start();
  }, [paused, scene]);

  useEffect(() => {
    if (resetSignal > 0) sceneRef.current?.resetView(true);
  }, [resetSignal]);

  useEffect(() => {
    if (!focusRequest) return;
    const node = nodesById.get(focusRequest.nodeId);
    if (!node) return;
    onSelect(node);
    sceneRef.current?.focusNode(node.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest]);

  const regionOf = useCallback(
    (clusterId: ClusterId) => graph.regions?.find((region) => region.clusterId === clusterId) ?? null,
    [graph.regions],
  );

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      resetView: () => sceneRef.current?.resetView(true),
      zoomBy: (factor) => sceneRef.current?.zoomBy(factor),
      focusNode: (id) => sceneRef.current?.focusNode(id),
      focusRegion: (clusterId) => {
        const region = regionOf(clusterId);
        if (region) sceneRef.current?.focusRegion(region);
      },
    };
    return () => {
      apiRef.current = null;
    };
  }, [apiRef, regionOf]);

  // --- Pointer handling ----------------------------------------------------
  // OrbitControls owns drag-to-rotate and scroll-to-zoom on the same element,
  // so a "click" is only a click if the pointer barely moved.
  const pointerDown = useRef<{ x: number; y: number; dragged: boolean } | null>(null);
  const lastHoverAt = useRef(0);

  const handlePointerDown = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    pointerDown.current = { x: event.clientX, y: event.clientY, dragged: false };
  }, []);

  const handlePointerMove = useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const down = pointerDown.current;
    if (down && !down.dragged) {
      if (Math.abs(event.clientX - down.x) > CLICK_SLOP_PX || Math.abs(event.clientY - down.y) > CLICK_SLOP_PX) {
        down.dragged = true;
      }
    }
    if (down?.dragged) {
      if (hoveredId) setHoveredId(null);
      return;
    }
    const now = performance.now();
    if (now - lastHoverAt.current < HOVER_THROTTLE_MS) return;
    lastHoverAt.current = now;
    const hit = sceneRef.current?.pick(event.clientX, event.clientY) ?? null;
    setHoveredId((current) => (current === hit ? current : hit));
  }, [hoveredId]);

  const handlePointerUp = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      const down = pointerDown.current;
      pointerDown.current = null;
      if (event.button !== 0 || !down || down.dragged) return;
      const hit = sceneRef.current?.pick(event.clientX, event.clientY) ?? null;
      if (!hit) {
        onSelect(null);
        return;
      }
      const node = nodesById.get(hit);
      if (!node) return;
      onSelect(node);
      sceneRef.current?.focusNode(node.id);
    },
    [nodesById, onSelect],
  );

  const handleContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onContextMenuNode) return;
      const hit = sceneRef.current?.pick(event.clientX, event.clientY) ?? null;
      const node = hit ? nodesById.get(hit) : null;
      if (!node) return;
      event.preventDefault();
      onContextMenuNode(node, { x: event.clientX, y: event.clientY });
    },
    [nodesById, onContextMenuNode],
  );

  const handleDoubleClick = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!onDoubleClickNode) return;
      const hit = sceneRef.current?.pick(event.clientX, event.clientY) ?? null;
      const node = hit ? nodesById.get(hit) : null;
      if (node) onDoubleClickNode(node);
    },
    [nodesById, onDoubleClickNode],
  );

  /** Arrow keys walk the selected node's neighbours; R resets the view;
   * Escape clears the selection. Scoped to the canvas so none of it hijacks
   * keys meant for the rest of the shell. */
  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLDivElement>) => {
      const instance = sceneRef.current;
      if (!instance) return;

      if (event.key === "Escape") {
        onSelect(null);
        return;
      }
      if (event.key === "r" || event.key === "R") {
        event.preventDefault();
        instance.resetView(true);
        return;
      }
      if (event.key === "+" || event.key === "=") {
        event.preventDefault();
        instance.zoomBy(0.72);
        return;
      }
      if (event.key === "-" || event.key === "_") {
        event.preventDefault();
        instance.zoomBy(1.38);
        return;
      }

      const forward = event.key === "ArrowRight" || event.key === "ArrowDown";
      const backward = event.key === "ArrowLeft" || event.key === "ArrowUp";
      if (!forward && !backward) return;
      event.preventDefault();

      if (!selectedId) {
        const hub = instance.firstHubId();
        const node = hub ? nodesById.get(hub) : null;
        if (node) {
          onSelect(node);
          instance.focusNode(node.id);
        }
        return;
      }

      const neighbors = instance.neighborIdsOf(selectedId);
      if (neighbors.length === 0) return;
      const current = hoveredId && neighbors.includes(hoveredId) ? neighbors.indexOf(hoveredId) : 0;
      const nextIndex = forward
        ? (current + 1) % neighbors.length
        : (current - 1 + neighbors.length) % neighbors.length;
      const next = nodesById.get(neighbors[nextIndex]);
      if (next) {
        onSelect(next);
        instance.focusNode(next.id);
      }
    },
    [hoveredId, nodesById, onSelect, selectedId],
  );

  if (renderError) {
    return (
      <div className="absolute inset-0 flex items-center justify-center bg-[#01040a] p-6">
        <div className="max-w-sm rounded-lg border border-[#1c2a3f] bg-[#080e18] p-4 text-center">
          <div className="text-[13px] font-semibold text-white/85">The graph canvas could not start</div>
          <p className="mt-1.5 text-[11px] leading-relaxed text-white/45">
            Sentinel renders the graph with WebGL, which this browser session refused: {renderError}. Panels and
            search still work; re-enable hardware acceleration to bring the canvas back.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className="absolute inset-0 h-full w-full overflow-hidden"
      role="application"
      aria-label="Sentinel graph canvas"
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerLeave={() => {
        pointerDown.current = null;
        setHoveredId(null);
      }}
      onContextMenu={handleContextMenu}
      onDoubleClick={handleDoubleClick}
    >
      <div ref={containerRef} className="absolute inset-0 h-full w-full" />
      <GlobeOverlay
        scene={scene}
        regions={graph.regions ?? []}
        showLabels={settings.showLabels}
        lensClusterId={lensClusterId}
        selected={selectedNode ? { id: selectedNode.id, label: selectedNode.label, type: selectedNode.type } : null}
        hovered={hoveredNode}
        onRegionClick={(clusterId) => onLensChange?.(lensClusterId === clusterId ? null : clusterId)}
      />
    </div>
  );
}
