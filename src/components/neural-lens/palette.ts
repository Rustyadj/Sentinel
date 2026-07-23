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

/**
 * Muted, technical hues for the focused neighborhood — one per
 * workspace/hub identity, cycled deterministically so a given
 * workspace always lights up the same color across sessions. Kept
 * desaturated to match the sparse-accent aesthetic; this only ever
 * colors the node/edges currently focused, never the baseline field.
 */
const GROUP_HUES = [
  "#7dd3fc", // sky (default/no-group fallback — matches the prior single accent)
  "#f0a35f", // amber
  "#c07dfc", // violet
  "#6fd6a8", // mint
  "#f27d9e", // rose
  "#9db8ea", // periwinkle
  "#e0c15f", // gold
  "#7de0c9", // teal
];

function hashString(value: string): number {
  let hash = 0;
  for (let i = 0; i < value.length; i++) {
    hash = (Math.imul(31, hash) + value.charCodeAt(i)) | 0;
  }
  return Math.abs(hash);
}

/** Deterministic focus color for a workspace (or hub, in DEMO mode where there's no real workspace). */
export function groupColor(key: string | undefined): string {
  if (!key) return GROUP_HUES[0];
  return GROUP_HUES[hashString(key) % GROUP_HUES.length];
}

/** `#rrggbb` -> `rgba(r, g, b, alpha)`, for translucent edge/particle tints. */
export function hexToRgba(hex: string, alpha: number): string {
  const value = hex.replace("#", "");
  const r = parseInt(value.slice(0, 2), 16);
  const g = parseInt(value.slice(2, 4), 16);
  const b = parseInt(value.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

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
