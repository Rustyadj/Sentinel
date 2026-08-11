"use client";

import { useEffect, useMemo, useRef } from "react";
import { CLUSTER_LABEL, type ClusterId } from "../categories";
import { clusterColor } from "../palette";
import type { GlobeRegion } from "../globeLayout";
import type { GlobeScene, ProjectedPoint } from "./GlobeScene";
import type { LensNode } from "../types";

interface GlobeOverlayProps {
  scene: GlobeScene | null;
  regions: GlobeRegion[];
  showLabels: boolean;
  lensClusterId: ClusterId | null;
  selected: { id: string; label: string; type: string } | null;
  hovered: LensNode | null;
  onRegionClick?: (clusterId: ClusterId) => void;
}

/** Screen-space breathing room between two region names. */
const LABEL_MIN_GAP_X = 96;
const LABEL_MIN_GAP_Y = 34;
/** Keeps the core region's name off the selection pill at the globe's centre. */
const CORE_LABEL_OFFSET_Y = 52;

function emptyPoint(): ProjectedPoint {
  return { x: 0, y: 0, distance: 0, onScreen: false };
}

/**
 * Everything drawn *over* the globe in DOM rather than WebGL: region names,
 * the selected node's focus frame, and the hover readout.
 *
 * Text stays in DOM on purpose — it renders at real device resolution, wraps,
 * and inherits the product's type scale instead of being baked into a texture.
 * The cost is that positions must be projected every frame, so this component
 * subscribes to the scene's frame loop and writes `transform`/`opacity`
 * straight to element refs. It never calls setState per frame, so React
 * re-renders only when the label set or the selection actually changes.
 */
export function GlobeOverlay({
  scene,
  regions,
  showLabels,
  lensClusterId,
  selected,
  hovered,
  onRegionClick,
}: GlobeOverlayProps) {
  const labelRefs = useRef(new Map<string, HTMLElement>());
  const selectionRef = useRef<HTMLDivElement | null>(null);
  const tooltipRef = useRef<HTMLDivElement | null>(null);

  // Labels only exist for regions that actually carry nodes; a region with a
  // handful of stragglers doesn't earn a name on the globe. Biggest first, so
  // the collision pass below resolves overlaps in favour of the region an
  // operator is more likely to be looking for.
  const labelledRegions = useMemo(
    () =>
      regions
        .filter((region) => region.nodeCount >= 8)
        .sort((a, b) => (a.core === b.core ? b.nodeCount - a.nodeCount : a.core ? -1 : 1)),
    [regions],
  );

  useEffect(() => {
    if (!scene) return;
    const point = emptyPoint();
    const placed: Array<{ x: number; y: number }> = [];

    return scene.addFrameListener((api) => {
      // --- region names
      placed.length = 0;
      for (const region of labelledRegions) {
        const element = labelRefs.current.get(region.clusterId);
        if (!element) continue;
        if (!showLabels) {
          element.style.opacity = "0";
          continue;
        }
        api.project(region.x, region.y, region.z, point);
        const facing = region.core || api.facesCamera(region.nx, region.ny, region.nz);
        if (!point.onScreen || !facing) {
          element.style.opacity = "0";
          continue;
        }
        // The core's anchor is the exact centre of the globe, which is also
        // where a selected node's label pill sits — nudge it clear.
        const y = region.core ? point.y + CORE_LABEL_OFFSET_Y : point.y;
        // As the globe turns, a far region's label can drift on top of a near
        // one. Whichever is drawn first (the list is ordered by size, so the
        // biggest regions win) keeps the space; the other drops out rather
        // than stacking two names on the same pixels.
        const collides = placed.some(
          (other) => Math.abs(other.x - point.x) < LABEL_MIN_GAP_X && Math.abs(other.y - y) < LABEL_MIN_GAP_Y,
        );
        if (collides) {
          element.style.opacity = "0";
          continue;
        }
        placed.push({ x: point.x, y });

        // Fade out as a region turns away from the camera and as it recedes,
        // so the front of the globe is legible and the back never competes.
        const depth = 1 - Math.min(1, Math.max(0, (point.distance - api.cameraDistance * 0.7) / (api.cameraDistance * 0.9)));
        const active = lensClusterId === region.clusterId;
        element.style.opacity = String(Math.max(0, active ? 0.65 + depth * 0.35 : 0.38 + depth * 0.5));
        element.style.transform = `translate3d(${point.x.toFixed(1)}px, ${y.toFixed(1)}px, 0) translate(-50%, -50%)`;
      }

      // --- selected node focus frame
      const frame = selectionRef.current;
      if (frame) {
        const position = selected ? api.nodePosition(selected.id) : null;
        if (!position) {
          frame.style.opacity = "0";
          frame.style.pointerEvents = "none";
        } else {
          api.project(position.x, position.y, position.z, point);
          frame.style.opacity = point.onScreen ? "1" : "0";
          frame.style.transform = `translate3d(${point.x.toFixed(1)}px, ${point.y.toFixed(1)}px, 0)`;
        }
      }

      // --- hover readout
      const tooltip = tooltipRef.current;
      if (tooltip) {
        const position = hovered ? api.nodePosition(hovered.id) : null;
        if (!position) {
          tooltip.style.opacity = "0";
        } else {
          api.project(position.x, position.y, position.z, point);
          tooltip.style.opacity = point.onScreen ? "1" : "0";
          tooltip.style.transform = `translate3d(${(point.x + 14).toFixed(1)}px, ${(point.y - 10).toFixed(1)}px, 0)`;
        }
      }
    });
  }, [scene, labelledRegions, showLabels, lensClusterId, selected, hovered]);

  return (
    <div className="pointer-events-none absolute inset-0 overflow-hidden">
      {/* Orientation marker — the globe's north pole, so rotation is readable. */}
      <div className="absolute left-1/2 top-2 flex -translate-x-1/2 flex-col items-center gap-1 text-white/25">
        <span className="text-[9px] font-medium tracking-[0.2em]">N</span>
        <span className="h-2 w-px bg-white/15" />
      </div>

      {labelledRegions.map((region) => {
        const clusterId = region.clusterId as ClusterId;
        const color = clusterColor(clusterId);
        const active = lensClusterId === clusterId;
        return (
          <button
            key={region.clusterId}
            type="button"
            ref={(element) => {
              if (element) labelRefs.current.set(region.clusterId, element);
              else labelRefs.current.delete(region.clusterId);
            }}
            onClick={() => onRegionClick?.(clusterId)}
            style={{ color: active ? "#ffffff" : color, opacity: 0, willChange: "transform, opacity" }}
            className={`pointer-events-auto absolute left-0 top-0 max-w-[112px] cursor-pointer text-center text-[9px] font-medium uppercase leading-[1.35] tracking-[0.19em] transition-[color] duration-200 hover:!opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-white/40 ${
              active ? "drop-shadow-[0_0_10px_rgba(167,139,250,0.5)]" : ""
            }`}
          >
            {CLUSTER_LABEL[clusterId] ?? region.clusterId}
          </button>
        );
      })}

      {/* Focus frame: corner brackets plus a label pill, sized so it reads as
          an instrument reticle rather than a tooltip. */}
      <div
        ref={selectionRef}
        style={{ opacity: 0, willChange: "transform, opacity" }}
        className="absolute left-0 top-0 transition-opacity duration-200"
      >
        {selected ? (
          <div className="relative -translate-x-1/2 -translate-y-1/2">
            <div className="relative h-[46px] w-[46px]">
              {[
                "left-0 top-0 border-l border-t",
                "right-0 top-0 border-r border-t",
                "left-0 bottom-0 border-l border-b",
                "right-0 bottom-0 border-r border-b",
              ].map((corner) => (
                <span key={corner} className={`absolute h-2.5 w-2.5 border-violet-300/80 ${corner}`} />
              ))}
            </div>
            <div className="absolute left-[34px] top-1/2 flex -translate-y-1/2 items-center gap-1.5 whitespace-nowrap rounded-[3px] border border-violet-400/35 bg-[#120e26]/85 py-1 pl-2 pr-2.5 backdrop-blur-md">
              <span className="h-1.5 w-1.5 rounded-full bg-violet-300 shadow-[0_0_6px_rgba(196,181,253,0.9)]" />
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-white/90">
                {selected.label}
              </span>
            </div>
          </div>
        ) : null}
      </div>

      <div
        ref={tooltipRef}
        style={{ opacity: 0, willChange: "transform, opacity" }}
        className="absolute left-0 top-0 transition-opacity duration-150"
      >
        {hovered ? (
          <div className="rounded-[3px] border border-white/10 bg-[#070b14]/92 px-2 py-1 backdrop-blur-md">
            <div className="text-[10px] font-medium text-white/85">{hovered.label}</div>
            <div className="text-[8.5px] uppercase tracking-[0.16em] text-white/40">
              {hovered.type}
              {hovered.clusterId ? ` · ${CLUSTER_LABEL[hovered.clusterId] ?? hovered.clusterId}` : ""}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
