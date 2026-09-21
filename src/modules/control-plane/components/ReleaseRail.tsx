"use client";

import { useId } from "react";
import { cn } from "@/lib/utils";
import type { RevisionPosition, StageId } from "@/lib/control-plane/types";
import { buildRailModel, toneFor, type ConnectorKind, type RailStop } from "./rail-model";

/**
 * The release rail: one horizontal line per repository, with a marker at the
 * revision's actual position.
 *
 * Drawn as a single SVG rather than eight elements in a flex row so the
 * connectors between stages are real geometry — a severed transition is a gap
 * in a line, not a differently-coloured box. The line is the primary
 * information; the stops are secondary.
 */

const STOP_GAP = 84;
const LEFT_PAD = 10;
const TRACK_Y = 14;
const DOT_R = 4.5;

function connectorStroke(kind: ConnectorKind): { className: string; dash?: string } {
  switch (kind) {
    case "carried":
      return { className: "stroke-[color:var(--rail-carried)]" };
    case "pending":
      return { className: "stroke-[color:var(--rail-pending)]", dash: "1 4" };
    case "severed":
      return { className: "stroke-[color:var(--rail-severed)]", dash: "5 5" };
    case "unknown":
      return { className: "stroke-[color:var(--rail-pending)]", dash: "1 6" };
  }
}

interface ReleaseRailProps {
  position: RevisionPosition;
  selectedStage: StageId | null;
  onSelectStage: (stage: StageId) => void;
}

export function ReleaseRail({ position, selectedStage, onSelectStage }: ReleaseRailProps) {
  const rail = buildRailModel(position);
  const gradientId = useId();
  const width = LEFT_PAD * 2 + STOP_GAP * (rail.stops.length - 1);

  return (
    <div className="overflow-x-auto">
      <svg
        viewBox={`0 0 ${width} 46`}
        width={width}
        height={46}
        role="group"
        aria-label={`Release position for ${position.name}: ${position.position}`}
        className="max-w-full"
      >
        <defs>
          {/* The marker's halo. Used once per rail, on the current stage only —
              if everything glowed, nothing would read as active. */}
          <radialGradient id={gradientId}>
            <stop offset="0%" stopColor="var(--rail-marker)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--rail-marker)" stopOpacity="0" />
          </radialGradient>
        </defs>

        {rail.stops.map((stop, index) => {
          if (index === 0) return null;
          const { className, dash } = connectorStroke(stop.connector);
          const x1 = LEFT_PAD + STOP_GAP * (index - 1) + DOT_R + 3;
          const x2 = LEFT_PAD + STOP_GAP * index - DOT_R - 3;
          return (
            <line
              key={`connector-${stop.stage.id}`}
              x1={x1}
              y1={TRACK_Y}
              x2={x2}
              y2={TRACK_Y}
              strokeWidth={stop.connector === "carried" ? 1.5 : 1}
              strokeDasharray={dash}
              strokeLinecap="round"
              className={className}
            />
          );
        })}

        {rail.stops.map((stop) => (
          <RailStopMark
            key={stop.stage.id}
            stop={stop}
            gradientId={gradientId}
            selected={selectedStage === stop.stage.id}
            onSelect={() => onSelectStage(stop.stage.id)}
          />
        ))}
      </svg>
    </div>
  );
}

function RailStopMark({
  stop,
  gradientId,
  selected,
  onSelect,
}: {
  stop: RailStop;
  gradientId: string;
  selected: boolean;
  onSelect: () => void;
}) {
  const x = LEFT_PAD + STOP_GAP * stop.index;
  const tone = toneFor(stop.stage.state);
  const filled = stop.stage.state === "reached" && !stop.isAhead;

  return (
    <g
      role="button"
      tabIndex={0}
      aria-pressed={selected}
      aria-label={`${stop.label}: ${stop.stage.detail}`}
      onClick={onSelect}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault();
          onSelect();
        }
      }}
      className="cursor-pointer outline-none [&:focus-visible>circle:first-of-type]:stroke-[color:var(--ring)]"
    >
      {/* Generous hit area; the visible mark stays small. */}
      <circle cx={x} cy={TRACK_Y} r={16} fill="transparent" strokeWidth={1.5} stroke="transparent" />

      {stop.isMarker ? (
        <circle cx={x} cy={TRACK_Y} r={13} fill={`url(#${gradientId})`} className="rail-marker-halo" />
      ) : null}

      <circle
        cx={x}
        cy={TRACK_Y}
        r={stop.isMarker ? DOT_R + 1 : DOT_R}
        strokeWidth={1.5}
        className={cn(
          "transition-[fill,stroke] duration-200",
          tone === "failure"
            ? "fill-[color:var(--rail-severed)] stroke-[color:var(--rail-severed)]"
            : tone === "attention"
              ? "fill-[color:var(--background)] stroke-[color:var(--rail-attention)]"
              : tone === "unknown"
                ? "fill-[color:var(--background)] stroke-[color:var(--rail-pending)]"
                : filled
                  ? "fill-[color:var(--rail-carried)] stroke-[color:var(--rail-carried)]"
                  : "fill-[color:var(--background)] stroke-[color:var(--rail-pending)]",
        )}
      />

      {/* A stage that is not connected was never asked, so it gets a mark that
          reads as absence rather than as a result: a hollow dot with a slash. */}
      {stop.stage.state === "not_connected" ? (
        <line
          x1={x - 3}
          y1={TRACK_Y + 3}
          x2={x + 3}
          y2={TRACK_Y - 3}
          strokeWidth={1}
          className="stroke-[color:var(--rail-pending)]"
        />
      ) : null}

      <text
        x={x}
        y={36}
        textAnchor="middle"
        className={cn(
          "select-none text-[9px] uppercase tracking-[0.09em]",
          selected
            ? "fill-[color:var(--foreground)]"
            : stop.isMarker
              ? "fill-[color:var(--foreground)]"
              : "fill-[color:var(--muted-foreground)]",
        )}
      >
        {stop.label}
      </text>
    </g>
  );
}
