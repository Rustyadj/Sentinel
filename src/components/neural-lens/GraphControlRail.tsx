"use client";

import { useId, useState } from "react";
import {
  Boxes,
  Braces,
  Brain,
  Bot,
  ChevronDown,
  Clock,
  Database,
  Globe2,
  Layers,
  Megaphone,
  MessagesSquare,
  Mic,
  Search,
  Server,
  ShieldAlert,
  Workflow,
} from "lucide-react";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";
import { CLUSTER_LAYER_ORDER, CLUSTER_SHORT_LABEL, type ClusterId } from "./categories";
import { ACCENT_COLORS, NEUTRAL_NODE, clusterColor } from "./palette";
import type { GlobeSettings } from "./graphSettings";

const LAYER_ICONS: Record<ClusterId, typeof Layers> = {
  Infrastructure: Server,
  Cybersecurity: ShieldAlert,
  Knowledge: Database,
  Memory: Brain,
  Organization: Bot,
  Learning: Workflow,
  Projects: Boxes,
  Coding: Braces,
  Marketing: Megaphone,
  Chat: MessagesSquare,
  Voice: Mic,
  External: Globe2,
};

interface GraphControlRailProps {
  lensClusterId: ClusterId | null;
  onLensChange: (clusterId: ClusterId | null) => void;
  lensOnly: boolean;
  onLensOnlyChange: (on: boolean) => void;
  settings: GlobeSettings;
  onSettingsChange: (patch: Partial<GlobeSettings>) => void;
  search: string;
  onSearchChange: (value: string) => void;
  typeChips: string[];
  activeTypes: Set<string>;
  onToggleType: (type: string) => void;
  demoMode: boolean;
  onToggleDemoMode: (demo: boolean) => void;
  /** Per-cluster node counts, so a layer row can say how big its region is. */
  layerCounts: Map<string, number>;
  timelineOpen: boolean;
  onToggleTimeline: () => void;
}

/**
 * Left rail: how the globe is drawn, and which layer of it is in focus.
 *
 * Two blocks, in the order an operator reaches for them — render controls
 * first (they change what you can see at all), then the layer picker, which is
 * the same lens state the rest of the shell reads. Selecting a layer never
 * reloads or re-lays-out the graph; it only changes emphasis.
 */
export function GraphControlRail({
  lensClusterId,
  onLensChange,
  lensOnly,
  onLensOnlyChange,
  settings,
  onSettingsChange,
  search,
  onSearchChange,
  typeChips,
  activeTypes,
  onToggleType,
  demoMode,
  onToggleDemoMode,
  layerCounts,
  timelineOpen,
  onToggleTimeline,
}: GraphControlRailProps) {
  const densityId = useId();
  const [typesOpen, setTypesOpen] = useState(false);

  return (
    <div className="pointer-events-auto absolute left-3 top-3 z-20 hidden w-[212px] flex-col gap-2 sm:flex">
      <section className="rounded-lg border border-white/[0.07] bg-[#070b13]/90 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">Graph controls</div>

        <div className="mt-2.5 grid grid-cols-2 gap-1 rounded-md border border-white/[0.05] bg-black/25 p-0.5">
          <button
            type="button"
            onClick={() => onLensOnlyChange(false)}
            aria-pressed={!lensOnly}
            className={cn(
              "rounded px-2 py-1.5 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]",
              !lensOnly
                ? "bg-violet-500/25 text-white shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)]"
                : "text-white/40 hover:text-white/70",
            )}
          >
            Full Graph
          </button>
          <button
            type="button"
            onClick={() => onLensOnlyChange(true)}
            aria-pressed={lensOnly}
            disabled={!lensClusterId}
            title={lensClusterId ? undefined : "Select a layer first — Lens Only needs something to isolate"}
            className={cn(
              "rounded px-2 py-1.5 text-[10.5px] font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]",
              "disabled:cursor-not-allowed disabled:opacity-35",
              lensOnly
                ? "bg-violet-500/25 text-white shadow-[inset_0_0_0_1px_rgba(167,139,250,0.35)]"
                : "text-white/40 hover:text-white/70",
            )}
          >
            Lens Only
          </button>
        </div>

        <div className="mt-3">
          <div className="flex items-baseline justify-between">
            <label htmlFor={densityId} className="text-[10px] text-white/55">
              Visual Density
            </label>
            <span className="font-mono text-[10px] text-white/40">{Math.round(settings.density * 100)}%</span>
          </div>
          <input
            id={densityId}
            type="range"
            min={20}
            max={100}
            step={1}
            value={Math.round(settings.density * 100)}
            onChange={(event) => onSettingsChange({ density: Number(event.target.value) / 100 })}
            className="sentinel-density-slider mt-1.5 h-1 w-full cursor-pointer appearance-none rounded-full bg-white/10 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]"
          />
        </div>

        <div className="mt-3 space-y-1.5 border-t border-white/[0.06] pt-2.5">
          <ToggleRow
            label="Show Labels"
            checked={settings.showLabels}
            onChange={(value) => onSettingsChange({ showLabels: value })}
          />
          <ToggleRow
            label="Show Edges"
            checked={settings.showEdges}
            onChange={(value) => onSettingsChange({ showEdges: value })}
          />
          <ToggleRow
            label="Glow Intensity"
            checked={settings.glow}
            onChange={(value) => onSettingsChange({ glow: value })}
          />
          <ToggleRow
            label="Animate Activity"
            checked={settings.animate}
            onChange={(value) => onSettingsChange({ animate: value })}
          />
          <ToggleRow
            label="Depth Fog"
            checked={settings.depthFog}
            onChange={(value) => onSettingsChange({ depthFog: value })}
          />
        </div>
      </section>

      <section className="rounded-lg border border-white/[0.07] bg-[#070b13]/90 p-3 shadow-[0_18px_50px_rgba(0,0,0,0.5)] backdrop-blur-xl">
        <div className="text-[9px] font-medium uppercase tracking-[0.2em] text-white/40">Filter layers</div>

        <div className="relative mt-2.5">
          <Search className="pointer-events-none absolute left-2 top-1/2 h-3 w-3 -translate-y-1/2 text-white/30" />
          <input
            value={search}
            onChange={(event) => onSearchChange(event.target.value)}
            placeholder="Search nodes…"
            aria-label="Search graph nodes"
            className="h-7 w-full rounded-md border border-white/[0.08] bg-white/[0.03] pl-7 pr-2 text-[11px] text-white/80 outline-none placeholder:text-white/25 focus:border-violet-400/40"
          />
        </div>

        <div className="mt-2 space-y-px">
          <LayerRow
            icon={Layers}
            label="All Layers"
            color="#ffffff"
            active={lensClusterId === null}
            onClick={() => onLensChange(null)}
          />
          {CLUSTER_LAYER_ORDER.map((clusterId) => (
            <LayerRow
              key={clusterId}
              icon={LAYER_ICONS[clusterId] ?? Layers}
              label={CLUSTER_SHORT_LABEL[clusterId]}
              color={clusterColor(clusterId)}
              count={layerCounts.get(clusterId)}
              active={lensClusterId === clusterId}
              onClick={() => onLensChange(lensClusterId === clusterId ? null : clusterId)}
            />
          ))}
        </div>

        {typeChips.length > 0 ? (
          <div className="mt-2 border-t border-white/[0.06] pt-2">
            <button
              type="button"
              onClick={() => setTypesOpen((open) => !open)}
              aria-expanded={typesOpen}
              className="flex w-full items-center gap-1.5 text-[9px] uppercase tracking-[0.18em] text-white/35 transition-colors hover:text-white/60"
            >
              <ChevronDown className={cn("h-3 w-3 transition-transform", typesOpen ? "" : "-rotate-90")} />
              Node types
              {activeTypes.size > 0 ? (
                <span className="ml-auto rounded bg-violet-500/20 px-1 font-mono text-[9px] normal-case tracking-normal text-violet-200">
                  {activeTypes.size}
                </span>
              ) : null}
            </button>
            {typesOpen ? (
              <div className="mt-2 flex flex-wrap gap-1">
                {typeChips.map((type) => {
                  const active = activeTypes.size === 0 || activeTypes.has(type);
                  const color = ACCENT_COLORS[type] ?? NEUTRAL_NODE;
                  return (
                    <button
                      key={type}
                      type="button"
                      onClick={() => onToggleType(type)}
                      aria-pressed={activeTypes.has(type)}
                      className="flex items-center gap-1 rounded border px-1.5 py-0.5 text-[9px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]"
                      style={{
                        borderColor: active ? `${color}55` : "rgba(255,255,255,0.07)",
                        color: active ? color : "rgba(255,255,255,0.35)",
                        backgroundColor: active ? `${color}12` : "transparent",
                      }}
                    >
                      <span className="h-1 w-1 rounded-full" style={{ backgroundColor: color }} />
                      {type}
                    </button>
                  );
                })}
              </div>
            ) : null}
          </div>
        ) : null}

        <div className="mt-2.5 flex items-center gap-1 border-t border-white/[0.06] pt-2.5">
          <SourceButton label="Demo" active={demoMode} tone="#5fae86" onClick={() => onToggleDemoMode(true)} />
          <SourceButton label="Scoped" active={!demoMode} tone="#a98bf5" onClick={() => onToggleDemoMode(false)} />
          <button
            type="button"
            onClick={onToggleTimeline}
            aria-pressed={timelineOpen}
            title="Time map — reconstruct the graph as it was"
            aria-label="Time map"
            className={cn(
              "flex h-6 w-6 shrink-0 items-center justify-center rounded transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]",
              timelineOpen ? "bg-white/[0.08] text-white/80" : "text-white/30 hover:text-white/60",
            )}
          >
            <Clock className="h-3 w-3" />
          </button>
        </div>
      </section>
    </div>
  );
}

function ToggleRow({
  label,
  checked,
  onChange,
}: {
  label: string;
  checked: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between">
      <label htmlFor={id} className="cursor-pointer text-[10.5px] text-white/55">
        {label}
      </label>
      <Switch id={id} checked={checked} onCheckedChange={onChange} />
    </div>
  );
}

function LayerRow({
  icon: Icon,
  label,
  color,
  count,
  active,
  onClick,
}: {
  icon: typeof Layers;
  label: string;
  color: string;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      // Without this the accessible name runs the label and the abbreviated
      // count together ("Cybersecurity2.2k").
      aria-label={count === undefined ? label : `${label} layer, ${count.toLocaleString()} nodes`}
      className={cn(
        "group flex w-full items-center gap-2 rounded px-2 py-[5px] text-left text-[10.5px] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]",
        active ? "bg-white/[0.07] text-white/90" : "text-white/45 hover:bg-white/[0.04] hover:text-white/75",
      )}
    >
      <Icon className="h-3 w-3 shrink-0" style={{ color: active ? color : undefined }} />
      <span className="truncate">{label}</span>
      {count !== undefined ? (
        <span className="ml-auto shrink-0 font-mono text-[9px] text-white/25 group-hover:text-white/40">
          {count > 999 ? `${Math.round(count / 100) / 10}k` : count}
        </span>
      ) : null}
    </button>
  );
}

function SourceButton({
  label,
  active,
  tone,
  onClick,
}: {
  label: string;
  active: boolean;
  tone: string;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        "flex flex-1 items-center justify-center gap-1.5 rounded border px-2 py-1 text-[9px] uppercase tracking-[0.14em] transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-[--ring]",
        active ? "border-white/[0.12] bg-white/[0.05] text-white/80" : "border-transparent text-white/30 hover:text-white/55",
      )}
    >
      <span
        className="h-1.5 w-1.5 rounded-full"
        style={{ backgroundColor: active ? tone : "rgba(255,255,255,0.18)" }}
      />
      {label}
    </button>
  );
}
