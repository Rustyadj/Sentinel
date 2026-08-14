"use client";

import { useState } from "react";
import { formatDistanceToNowStrict } from "date-fns";
import { Copy, Crosshair, ExternalLink, Home, Minus, Plus, Target, X } from "lucide-react";
import { cn } from "@/lib/utils";
import type { GraphNodeSummary } from "@/store/useGraphStore";
import { CLUSTER_LABEL, type ClusterId } from "./categories";
import {
  CONNECTED_NODE_OPACITY,
  EDGE_LIT_HEX,
  LENS_ACCENT,
  RELATED_NODE,
  SELECTED_NODE,
  clusterColor,
} from "./palette";
import { NodeFacetList, Stat, nodeTier } from "./NodeFacets";
import { GraphMinimap } from "./GraphMinimap";
import { formatRelationshipType } from "./relationships";
import type { LensGraph, SemanticZoomLevel } from "./types";
import type { NeuralStreamEvent } from "./useNeuralStream";
import type { GlobeScene } from "./globe/GlobeScene";

/** A neighbor of the selected node, plus the relationship the connecting
 * edge carries (e.g. "depends_on") — see NeuralLens.tsx's connectedEntities. */
type ConnectedEntity = GraphNodeSummary & { relationship?: string };

interface GraphContextRailProps {
  graph: LensGraph;
  scene: GlobeScene | null;
  /** Totals for the graph as laid out, before density thinning. */
  nodeCount: number;
  edgeCount: number;
  connected: boolean;
  events: NeuralStreamEvent[];
  lensClusterId: ClusterId | null;
  lensOnly: boolean;
  onLensChange: (clusterId: ClusterId | null) => void;
  selected: GraphNodeSummary | null;
  connectedEntities: ConnectedEntity[];
  onClearSelection: () => void;
  onFocusEntity: (label: string) => void;
  onOpenModule: () => void;
  zoomLevel: SemanticZoomLevel;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onResetView: () => void;
  onFrameSelection: () => void;
  asOf?: Date | null;
  demoMode: boolean;
}

type RailTab = "overview" | "details";

/**
 * Right rail: what the graph currently is, and what the operator has selected.
 *
 * Overview answers "what am I looking at" (totals, live state, active lens,
 * what just happened, how to read the colours). Details answers "what did I
 * just click". Both stay compact — the globe is the hero, and this rail exists
 * to explain it, not to compete with it.
 */
export function GraphContextRail({
  graph,
  scene,
  nodeCount,
  edgeCount,
  connected,
  events,
  lensClusterId,
  lensOnly,
  onLensChange,
  selected,
  connectedEntities,
  onClearSelection,
  onFocusEntity,
  onOpenModule,
  zoomLevel,
  onZoomIn,
  onZoomOut,
  onResetView,
  onFrameSelection,
  asOf,
  demoMode,
}: GraphContextRailProps) {
  // Selecting a node is a request to see its detail, so by default the rail
  // follows the selection. An explicit tab click overrides that — but only for
  // as long as the same node stays selected, so the next selection opens
  // Details again instead of leaving the operator on a stale Overview. Stored
  // as an override rather than plain tab state so neither an effect nor a
  // render-phase setState is needed to keep the two in sync.
  const selectionId = selected?.id ?? null;
  const [override, setOverride] = useState<{ tab: RailTab; forSelection: string | null } | null>(null);
  const activeTab: RailTab =
    override && override.forSelection === selectionId ? override.tab : selected ? "details" : "overview";
  const setTab = (next: RailTab) => setOverride({ tab: next, forSelection: selectionId });

  return (
    <aside className="pointer-events-auto absolute right-3 top-3 z-20 hidden w-[248px] flex-col gap-2 lg:flex">
      <div className="rounded-lg border border-white/[0.07] bg-[#070b13]/90 shadow-[0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="grid grid-cols-2 border-b border-white/[0.06]">
          {(["overview", "details"] as const).map((id) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              aria-selected={activeTab === id}
              role="tab"
              className={cn(
                "relative py-2 text-[9.5px] font-medium uppercase tracking-[0.18em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-[--ring]",
                activeTab === id ? "text-white/85" : "text-white/35 hover:text-white/60",
              )}
            >
              {id}
              {activeTab === id ? (
                <span className="absolute inset-x-3 -bottom-px h-px bg-violet-400/70" />
              ) : null}
            </button>
          ))}
        </div>

        <div className="max-h-[calc(100vh-320px)] overflow-y-auto p-3">
          {activeTab === "overview" ? (
            <OverviewTab
              nodeCount={nodeCount}
              edgeCount={edgeCount}
              connected={connected}
              events={events}
              lensClusterId={lensClusterId}
              lensOnly={lensOnly}
              onLensChange={onLensChange}
              zoomLevel={zoomLevel}
              asOf={asOf}
              demoMode={demoMode}
            />
          ) : (
            <DetailsTab
              selected={selected}
              connectedEntities={connectedEntities}
              onClearSelection={onClearSelection}
              onFocusEntity={onFocusEntity}
              onOpenModule={onOpenModule}
              onFrameSelection={onFrameSelection}
            />
          )}
        </div>
      </div>

      <div className="flex items-end gap-2">
        <div className="min-w-0 flex-1 rounded-lg border border-white/[0.07] bg-[#070b13]/90 p-1.5 shadow-[0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <GraphMinimap graph={graph} scene={scene} />
        </div>
        <div className="flex flex-col gap-1 rounded-lg border border-white/[0.07] bg-[#070b13]/90 p-1 shadow-[0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl">
          <IconButton label="Reset view (R)" onClick={onResetView}>
            <Home className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Frame selection" onClick={onFrameSelection} disabled={!selected}>
            <Target className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Zoom in" onClick={onZoomIn}>
            <Plus className="h-3.5 w-3.5" />
          </IconButton>
          <IconButton label="Zoom out" onClick={onZoomOut}>
            <Minus className="h-3.5 w-3.5" />
          </IconButton>
        </div>
      </div>
    </aside>
  );
}

function OverviewTab({
  nodeCount,
  edgeCount,
  connected,
  events,
  lensClusterId,
  lensOnly,
  onLensChange,
  zoomLevel,
  asOf,
  demoMode,
}: Pick<
  GraphContextRailProps,
  "nodeCount" | "edgeCount" | "connected" | "events" | "lensClusterId" | "lensOnly" | "onLensChange" | "zoomLevel" | "asOf" | "demoMode"
>) {
  const lensName = lensClusterId ? CLUSTER_LABEL[lensClusterId] : "Full Graph";

  return (
    <div className="space-y-4">
      <section>
        <SectionTitle>Graph status</SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-1.5">
          <Metric label="Nodes" value={formatCount(nodeCount)} />
          <Metric label="Connections" value={formatCount(edgeCount)} />
        </div>
        <div className="mt-1.5 flex items-center justify-between rounded border border-white/[0.05] bg-white/[0.03] px-1.5 py-1.5">
          <span className="text-[8.5px] uppercase tracking-[0.12em] text-white/30">Events this session</span>
          <span className="font-mono text-[12px] text-white/85">{formatCount(events.length)}</span>
        </div>
        <div className="mt-2 flex items-center justify-between text-[10px]">
          <span className="text-white/35">Live updates</span>
          {asOf ? (
            <span className="flex items-center gap-1.5 text-amber-300/80">
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              Historical
            </span>
          ) : (
            <span className={cn("flex items-center gap-1.5", connected ? "text-emerald-300/80" : "text-white/40")}>
              <span
                className={cn("h-1.5 w-1.5 rounded-full", connected ? "animate-pulse bg-emerald-400" : "bg-white/25")}
              />
              {connected ? "Connected" : "Reconnecting…"}
            </span>
          )}
        </div>
        <div className="mt-1 flex items-center justify-between text-[10px]">
          <span className="text-white/35">Zoom</span>
          <span className="capitalize text-white/55">{zoomLevel}</span>
        </div>
      </section>

      <section className="border-t border-white/[0.06] pt-3">
        <div className="flex items-center justify-between">
          <SectionTitle>Active lens</SectionTitle>
          {lensClusterId ? (
            <button
              type="button"
              onClick={() => onLensChange(null)}
              className="rounded px-1 text-[9px] uppercase tracking-[0.14em] text-violet-300 transition-colors hover:text-violet-200 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]"
            >
              Clear
            </button>
          ) : null}
        </div>
        <div className="mt-1.5 flex items-center gap-2">
          <span
            className="h-2 w-2 shrink-0 rounded-full"
            style={{ backgroundColor: lensClusterId ? clusterColor(lensClusterId) : "rgba(255,255,255,0.5)" }}
          />
          <span className="truncate text-[12px] font-medium text-white/85">{lensName}</span>
        </div>
        <p className="mt-1 text-[10px] leading-relaxed text-white/35">
          {lensClusterId
            ? lensOnly
              ? "Showing this layer and its direct dependencies. Positions are unchanged."
              : "This layer is lit; the rest of the graph stays visible and dimmed."
            : "Showing all layers and relationships."}
        </p>
      </section>

      <section className="border-t border-white/[0.06] pt-3">
        <SectionTitle>Activity feed</SectionTitle>
        {events.length > 0 ? (
          <ul className="mt-2 space-y-2">
            {events.slice(0, 6).map((event) => (
              <li key={event.id} className="flex gap-2">
                <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-violet-400/70" />
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[10.5px] text-white/70">{humanizeEventType(event.type)}</div>
                  <div className="text-[9px] text-white/30">{relativeTime(event.createdAt)}</div>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-[10px] leading-relaxed text-white/35">
            {demoMode
              ? "No live events — the graph is showing demo data. Switch to Scoped to follow real activity."
              : "No knowledge events yet in this session. New activity appears here as it lands."}
          </p>
        )}
      </section>

      <section className="border-t border-white/[0.06] pt-3">
        <SectionTitle>Graph legend</SectionTitle>
        <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
          <LegendDot color={SELECTED_NODE} label="Selected" />
          <LegendLine color={EDGE_LIT_HEX} label="Selected link" opacity={0.8} />
          <LegendDot color={LENS_ACCENT} label="Active lens" />
          <LegendLine color={LENS_ACCENT} label="In-lens link" opacity={0.55} />
          <LegendDot color={RELATED_NODE} label="Related" />
          <LegendLine color="#5a7ba8" label="Baseline link" opacity={0.3} />
          <LegendDot color="#57c2a8" label="Live activity" opacity={CONNECTED_NODE_OPACITY} />
          <LegendLine color={LENS_ACCENT} label="Active path" dashed opacity={0.9} />
          <LegendDot color="#8298b8" label="Dimmed" opacity={0.35} />
          <LegendDot color="#8298b8" label="Filtered out" opacity={0.12} />
        </div>
      </section>
    </div>
  );
}

function DetailsTab({
  selected,
  connectedEntities,
  onClearSelection,
  onFocusEntity,
  onOpenModule,
  onFrameSelection,
}: Pick<
  GraphContextRailProps,
  "selected" | "connectedEntities" | "onClearSelection" | "onFocusEntity" | "onOpenModule" | "onFrameSelection"
>) {
  if (!selected) {
    return (
      <div className="py-6 text-center">
        <div className="text-[11px] font-medium text-white/60">Nothing selected</div>
        <p className="mt-1 text-[10px] leading-relaxed text-white/35">
          Click a node on the globe — or press the arrow keys — to inspect it and light up its neighbourhood.
        </p>
      </div>
    );
  }

  const color = selected.clusterId ? clusterColor(selected.clusterId) : "#8298b8";

  return (
    <div className="space-y-3">
      <div className="flex items-start gap-2">
        <span className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: color }} />
        <div className="min-w-0 flex-1">
          <div className="text-[9px] uppercase tracking-[0.18em] text-white/40">{selected.type}</div>
          <div className="truncate text-[13px] font-medium text-white/90">{selected.label}</div>
          {selected.clusterId ? (
            <div className="mt-0.5 text-[9.5px] uppercase tracking-[0.14em]" style={{ color }}>
              {CLUSTER_LABEL[selected.clusterId]}
            </div>
          ) : null}
        </div>
        <button
          type="button"
          onClick={onClearSelection}
          aria-label="Clear selection"
          className="rounded p-0.5 text-white/35 transition-colors hover:text-white/80 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>

      <NodeFacetList node={selected} />

      <div className="grid grid-cols-3 gap-1.5 border-t border-white/[0.06] pt-3">
        <Stat label="Degree" value={String(connectedEntities.length)} />
        <Stat label="Weight" value={selected.val.toFixed(1)} />
        <Stat label="Tier" value={nodeTier(selected.val)} />
      </div>

      {connectedEntities.length > 0 ? (
        <div className="border-t border-white/[0.06] pt-3">
          <SectionTitle>Connected</SectionTitle>
          <div className="mt-1.5 space-y-0.5">
            {connectedEntities.map((entity) => (
              <button
                key={entity.id}
                type="button"
                onClick={() => onFocusEntity(entity.label)}
                title={`${selected.label} → ${formatRelationshipType(entity.relationship)} → ${entity.label}`}
                className="flex w-full items-center gap-2 rounded px-1.5 py-1 text-left text-[10.5px] text-white/55 transition-colors hover:bg-white/[0.05] hover:text-white/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]"
              >
                <span className="h-1 w-1 shrink-0 rounded-full bg-white/25" />
                <span className="truncate">{entity.label}</span>
                <span className="ml-2 shrink-0 text-[8.5px] uppercase tracking-wide text-violet-300/70">
                  {formatRelationshipType(entity.relationship)}
                </span>
                <span className="ml-auto shrink-0 text-[8.5px] uppercase tracking-wide text-white/25">
                  {entity.type}
                </span>
              </button>
            ))}
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-1.5 border-t border-white/[0.06] pt-3">
        <button
          type="button"
          onClick={onOpenModule}
          className="flex flex-1 items-center justify-center gap-1.5 rounded border border-white/[0.09] py-1.5 text-[10.5px] text-white/70 transition-colors hover:bg-white/[0.05] focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]"
        >
          <ExternalLink className="h-3 w-3" />
          Open module
        </button>
        <IconButton label="Copy node id" onClick={() => void navigator.clipboard?.writeText(selected.id)} bordered>
          <Copy className="h-3 w-3" />
        </IconButton>
        <IconButton label="Frame this node" onClick={onFrameSelection} bordered>
          <Crosshair className="h-3 w-3" />
        </IconButton>
      </div>
    </div>
  );
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return <div className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">{children}</div>;
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded border border-white/[0.05] bg-white/[0.03] px-1.5 py-1.5">
      <div className="truncate text-[8.5px] uppercase tracking-[0.12em] text-white/30">{label}</div>
      <div className="mt-0.5 font-mono text-[12px] text-white/85">{value}</div>
    </div>
  );
}

function LegendDot({ color, label, opacity = 1 }: { color: string; label: string; opacity?: number }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ backgroundColor: color, opacity }} />
      <span className="truncate text-[9.5px] text-white/45">{label}</span>
    </div>
  );
}

function LegendLine({
  color,
  label,
  opacity = 1,
  dashed,
}: {
  color: string;
  label: string;
  opacity?: number;
  dashed?: boolean;
}) {
  return (
    <div className="flex items-center gap-1.5">
      <span
        className="h-0 w-3 shrink-0 border-t"
        style={{ borderColor: color, opacity, borderStyle: dashed ? "dashed" : "solid" }}
      />
      <span className="truncate text-[9.5px] text-white/45">{label}</span>
    </div>
  );
}

function IconButton({
  label,
  onClick,
  disabled,
  bordered,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  bordered?: boolean;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      title={label}
      aria-label={label}
      className={cn(
        "flex h-7 w-7 items-center justify-center rounded text-white/50 transition-colors",
        "hover:bg-white/[0.07] hover:text-white/85 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]",
        "disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent",
        bordered ? "border border-white/[0.09]" : "",
      )}
    >
      {children}
    </button>
  );
}

function formatCount(value: number): string {
  return value.toLocaleString();
}

function humanizeEventType(type: string): string {
  const spaced = type.replace(/[._-]/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2");
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function relativeTime(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "just now";
  try {
    return `${formatDistanceToNowStrict(date)} ago`;
  } catch {
    return "just now";
  }
}
