// Neural Lens — colour palette (Phase D).
//
// Matches the reference: a near-black field of mostly neutral white/blue-gray
// dots with sparse, muted colour accents. No neon, no rainbow.

export const LENS_BG = "#010409";

/** Neutral dot colour for the bulk of the graph. */
export const NEUTRAL_NODE = "#9fb2cc";
export const HUB_NODE = "#cdd9ec";

/** Muted accent tints by type. Only a minority of nodes use these. */
export const ACCENT_COLORS: Record<string, string> = {
  Memory: "#5fae86",
  Decision: "#c96b6b",
  Agent: "#c2a06a",
  Note: "#c7a15f",
  Task: "#6f97c9",
  Artifact: "#8fb668",
  Concept: "#9d86bf",
};

export const EDGE_BASE = "rgba(96, 130, 175, 0.13)";
export const EDGE_HIGHLIGHT = "rgba(140, 190, 245, 0.6)";
export const PARTICLE_COLOR = "#7dd3fc";

/** The muted lens accents used for filter chips / legend swatches. */
export function nodeColor(type: string, accent: boolean, isHub: boolean): string {
  if (isHub) return HUB_NODE;
  if (accent && ACCENT_COLORS[type]) return ACCENT_COLORS[type];
  return NEUTRAL_NODE;
}

export type SemanticZoomLevel = "galaxy" | "cluster" | "neighborhood" | "detail";

export function zoomLevelFor(scale: number): SemanticZoomLevel {
  if (scale < 0.45) return "galaxy";
  if (scale < 1.1) return "cluster";
  if (scale < 2.6) return "neighborhood";
  return "detail";
}
