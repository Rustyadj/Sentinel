import { STAGE_IDS, type RevisionPosition, type Stage, type StageId, type StageState } from "@/lib/control-plane/types";

/**
 * Presentation model for the rail.
 *
 * The visual language is deliberately not one colour per state. Colour carries
 * only three meanings — attention, failure, and everything else — while
 * position, fill and connector treatment carry the rest. A rail that recolours
 * every stage reads as a legend to be decoded; this one reads as a line with a
 * marker on it.
 */

export const STAGE_LABELS: Record<StageId, string> = {
  working: "Working",
  committed: "Commit",
  pushed: "Origin",
  pr: "PR",
  merged: "Main",
  built: "Build",
  deployed: "Deploy",
  verified: "Live",
};

/** How the segment *leading into* a stage is drawn. */
export type ConnectorKind = "carried" | "pending" | "severed" | "unknown";

export interface RailStop {
  stage: Stage;
  label: string;
  index: number;
  /** The marker sits here: the furthest stage this revision actually reached. */
  isMarker: boolean;
  /** Past the marker, so not yet true of this revision. */
  isAhead: boolean;
  connector: ConnectorKind;
}

export interface RailModel {
  stops: RailStop[];
  markerIndex: number;
  /** A stage holding a different revision — the case worth interrupting for. */
  divergedIndex: number | null;
  blockedIndex: number | null;
}

function connectorFor(state: StageState, reachedSoFar: boolean): ConnectorKind {
  if (state === "blocked") return "severed";
  if (state === "diverged") return "severed";
  if (state === "unknown" || state === "not_connected") return "unknown";
  return reachedSoFar && state === "reached" ? "carried" : "pending";
}

export function buildRailModel(position: RevisionPosition): RailModel {
  const markerIndex = STAGE_IDS.indexOf(position.position);
  let carried = true;

  const stops = STAGE_IDS.map((id, index) => {
    const stage = position.stages.find((candidate) => candidate.id === id);
    const resolved: Stage = stage ?? {
      id,
      state: "unknown",
      sha: null,
      detail: "Not observed.",
      evidence: [],
    };
    const connector = index === 0 ? "carried" : connectorFor(resolved.state, carried);
    if (connector !== "carried") carried = false;

    return {
      stage: resolved,
      label: STAGE_LABELS[id],
      index,
      isMarker: index === markerIndex,
      isAhead: index > markerIndex,
      connector,
    } satisfies RailStop;
  });

  const diverged = stops.find((stop) => stop.stage.state === "diverged");
  const blocked = stops.find((stop) => stop.stage.state === "blocked");

  return {
    stops,
    markerIndex,
    divergedIndex: diverged?.index ?? null,
    blockedIndex: blocked?.index ?? null,
  };
}

/** Semantic tone. Three meanings only — see the note at the top of this file. */
export type Tone = "neutral" | "attention" | "failure" | "unknown";

export function toneFor(state: StageState): Tone {
  switch (state) {
    case "reached":
      return "neutral";
    case "diverged":
      return "attention";
    case "blocked":
      return "failure";
    case "unknown":
    case "not_connected":
      return "unknown";
    default:
      return "neutral";
  }
}
