// Neural Lens — colour system for the globe renderer.
//
// Near-black space, a field of faint blue-white dust, and a small number of
// deliberate accents. Sentinel purple is reserved for the thing the operator
// is acting on — the selected node and the active lens — so purple always
// means "this is live/mine" rather than "this is decoration". Every other
// region gets one muted hue from a narrow palette (blue, cyan, teal, amber,
// violet, soft white); nothing is allowed to be neon, and no two regions are
// equally loud.

import type { ClusterId } from "./categories";
import type { SemanticZoomLevel } from "./types";

export const LENS_BG = "#01040a";

// ---------------------------------------------------------------------------
// Node states
// ---------------------------------------------------------------------------

/** The bulk of the graph: faint blue-white dust. Deliberately close to
 * neutral — regions read through a *tint* of this, so the globe as a whole
 * stays blue-white instead of taking on whichever hue is most common. */
export const NEUTRAL_NODE = "#95a9cc";
/** Structural hubs (Workspace/Project/Repository/…): same family, brighter. */
export const HUB_NODE = "#c3d1e8";
/** The hub currently targeted by the active lens. */
export const LENS_HUB_NODE = "#b49bf7";
/** Sentinel purple, as the graph uses it: emphasis, never decoration. */
export const LENS_ACCENT = "#a78bfa";
/** A user-selected node — a near-white core inside a purple bloom. */
export const SELECTED_NODE = "#f4efff";
export const SELECTED_GLOW = "#8f6ff2";
/** Direct neighbours of the selection. Fixed rather than derived from the
 * node's workspace: "related to what I clicked" has to mean the same colour
 * every time, and the legend has to be able to name it. Workspace identity
 * colour (groupColor) still drives live-activity lighting. */
export const RELATED_NODE = "#8fb0f5";

export const NEUTRAL_NODE_OPACITY_RANGE: [number, number] = [0.6, 1];
export const HUB_NODE_OPACITY = 0.9;
export const CONNECTED_NODE_OPACITY = 0.85;
/** Multiplier applied to anything outside the active lens in Full Graph mode —
 * present, legible as structure, clearly not the subject. */
export const OUT_OF_LENS_DIM = 0.3;

/** Draw radius (world units at the globe's scale) by role. Most nodes stay
 * tiny; only hubs and the selection are allowed to read as objects. */
export const NODE_RADIUS = {
  normal: [1.5, 3.5] as [number, number],
  hub: 5,
  /** A region's primary hub — the thing its name is attached to. */
  majorHub: 8,
  selected: 8,
};

/** Muted accent tints by category. Only a minority of nodes use these —
 * everything else falls back to NEUTRAL_NODE. */
export const ACCENT_COLORS: Record<string, string> = {
  Memory: "#57c2a8",
  Decision: "#c97f7f",
  Agent: "#b49bf7",
  Knowledge: "#c9ab6a",
  Task: "#6aa9e9",
  File: "#7fb489",
  Threat: "#c9757f",
  Detection: "#dba05e",
};

// ---------------------------------------------------------------------------
// Cluster identity — one muted, distinguishable hue per OS-level region.
// Stable and explicit (not hashed) so "which region is this" reads the same
// way every session, in legends, layer rows, and region labels alike.
// ---------------------------------------------------------------------------

export const CLUSTER_COLORS: Record<ClusterId, string> = {
  Chat: "#5c9fe0",
  Projects: "#e09a52",
  Knowledge: "#4a89c4",
  Memory: "#57c2a8",
  Learning: "#d4b45f",
  Cybersecurity: "#9179ef",
  Coding: "#dd8a4c",
  Organization: "#a98bf5",
  Infrastructure: "#4f7fc9",
  Voice: "#93a2d8",
  External: "#b57cf0",
};

export function clusterColor(cluster: ClusterId): string {
  return CLUSTER_COLORS[cluster] ?? CLUSTER_COLORS.Infrastructure;
}

// ---------------------------------------------------------------------------
// Edges — near-invisible at rest, brighten only for hover/selection/activity.
// ---------------------------------------------------------------------------

/** Edge colours for THREE.Color, which doesn't reliably parse rgba strings —
 * the WebGL layer applies alpha separately via vertex-colour scaling.
 *
 * The baseline is deliberately indigo rather than blue-grey: edges are drawn
 * additively and there are >100k of them, so wherever the web is dense their
 * colour accumulates. A blue-grey base saturates its blue and green channels
 * first and floods the globe with cyan; indigo accumulates toward the violet
 * the rest of the system already speaks. */
export const EDGE_BASE_HEX = "#5a63a6";
export const EDGE_LIT_HEX = "#8cbef5";
export const EDGE_ACTIVE_HEX = "#ffffff";
/** The active lens's edges: purple, matching the lens accent. */
export const EDGE_LENS_HEX = "#8f76e8";

/** Baseline alpha for an edge at rest — deliberately near the floor of what a
 * display can show, because tens of thousands of them add up. */
export const EDGE_BASE_ALPHA = 0.021;
export const EDGE_LENS_ALPHA = 0.062;
export const EDGE_LIT_ALPHA = 0.5;
export const EDGE_OUT_OF_LENS_ALPHA = 0.008;

/** Depth-fog band, as fractions of the camera's distance to the globe centre:
 * nothing fades before `near`, everything past `far` is at full fog. Keeping
 * these relative means fog reads the same whether you're framing the whole
 * globe or one cluster. */
export const FOG = { near: 0.6, far: 1.68, strength: 0.86 };

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

/**
 * FNV-1a with an avalanche finalizer, normalised to [0, 1).
 *
 * The plain multiply-31 hash above is fine for picking a bucket out of eight,
 * but it clusters badly for the near-identical ids a graph is full of
 * ("…-c1", "…-c2", …): taken as a fraction, three quarters of a sequential run
 * lands in the bottom half of the range. That skew would quietly break the
 * density control, whose whole contract is that keeping the lowest-ranked 70%
 * of nodes draws about 70% of them. The finalizer spreads adjacent inputs
 * across the whole range, so per-node variation is even and thinning the field
 * removes roughly the fraction the operator asked for.
 */
function hashUnit(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  hash ^= hash >>> 15;
  hash = Math.imul(hash, 2246822507);
  hash ^= hash >>> 13;
  hash = Math.imul(hash, 3266489909);
  hash ^= hash >>> 16;
  return (hash >>> 0) / 4294967296;
}

/** Deterministic focus color for a workspace (or hub, in DEMO mode where there's no real workspace). */
export function groupColor(key: string | undefined): string {
  if (!key) return GROUP_HUES[0];
  return GROUP_HUES[hashString(key) % GROUP_HUES.length];
}

/** Deterministic radius for a "normal" node — stable per id so it doesn't
 * flicker in size across renders. */
export function normalNodeRadius(id: string): number {
  const [min, max] = NODE_RADIUS.normal;
  return min + hashUnit(`${id}:radius`) * (max - min);
}

/** Deterministic subtle opacity variation for a "normal" node. */
export function normalNodeOpacity(id: string): number {
  const [min, max] = NEUTRAL_NODE_OPACITY_RANGE;
  return min + hashUnit(`${id}:opacity`) * (max - min);
}

/**
 * Deterministic 0..1 "rank" for a node, used by the visual-density control:
 * density 60% keeps the 60% of the dust field with the lowest rank. Because
 * the rank is derived from the id, lowering density always removes the same
 * dots and raising it brings the same ones back — the field thins out, it
 * doesn't reshuffle.
 */
export function densityRank(id: string): number {
  return hashUnit(`${id}:density`);
}

export function zoomLevelFor(scale: number): SemanticZoomLevel {
  if (scale < 0.25) return "galaxy";
  if (scale < 0.55) return "cluster";
  if (scale < 1.1) return "region";
  if (scale < 2.6) return "neighborhood";
  return "detail";
}
