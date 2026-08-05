// Neural Lens — colour palette (Phase E: OS-scale graph).
//
// Near-black field of mostly dim blue-gray dots. No neon, no rainbow, no
// glowing-Christmas-tree hub nodes. Almost everything is quiet; the handful
// of things that should stand out (hubs, the active lens, a selection,
// activity) each get exactly one distinct treatment so the eye can tell them
// apart at a glance without the graph ever looking busy.

import type { ClusterId } from "./categories";
import type { SemanticZoomLevel } from "./types";

export const LENS_BG = "#010409";

// ---------------------------------------------------------------------------
// Node states
// ---------------------------------------------------------------------------

/** The bulk of the graph: dim blue-gray, 1-3px, barely-there opacity. */
export const NEUTRAL_NODE = "#7f92ac";
/** Structural hubs (Workspace/Project/Conversation/…): same family, brighter. */
export const HUB_NODE = "#b9c8e0";
/** The hub currently targeted by the active lens — the one deliberate accent
 * color allowed outside the muted cluster palette. */
export const LENS_HUB_NODE = "#b083f0";
/** A user-selected node: white outline + small bloom, per the brief. */
export const SELECTED_NODE = "#ffffff";

export const NEUTRAL_NODE_OPACITY_RANGE: [number, number] = [0.35, 0.6];
export const HUB_NODE_OPACITY = 0.85;
export const CONNECTED_NODE_OPACITY = 0.8;
export const FADED_NODE_OPACITY = 0.08;
export const SELECTED_NODE_OPACITY = 1;

/** Draw-radius (px) by role — most nodes stay in the 1-3px band. */
export const NODE_RADIUS = {
  normal: [1, 3] as [number, number],
  hub: 5,
  lensHub: 6.5,
  selected: 4.5,
};

/** Muted accent tints by category. Only a minority of nodes use these —
 * everything else falls back to NEUTRAL_NODE. */
export const ACCENT_COLORS: Record<string, string> = {
  Memory: "#5fae86",
  Decision: "#c96b6b",
  Agent: "#c2a06a",
  Knowledge: "#c7a15f",
  Task: "#6f97c9",
  File: "#8fb668",
  Threat: "#c9686f",
  Detection: "#d99a52",
};

// ---------------------------------------------------------------------------
// Cluster identity — one muted, distinguishable hue per OS-level region.
// Stable and explicit (not hashed) so "which region is this" reads the same
// way every session, in legends, chips, and cluster-outline rings alike.
// ---------------------------------------------------------------------------

export const CLUSTER_COLORS: Record<ClusterId, string> = {
  Chat: "#7dd3fc",
  Projects: "#6f97c9",
  Knowledge: "#c7a15f",
  Memory: "#5fae86",
  Learning: "#7de0c9",
  Cybersecurity: "#c9686f",
  Coding: "#9db8ea",
  Organization: "#c2a06a",
  Infrastructure: "#8a94a8",
  Voice: "#c07dfc",
};

export function clusterColor(cluster: ClusterId): string {
  return CLUSTER_COLORS[cluster] ?? CLUSTER_COLORS.Infrastructure;
}

// ---------------------------------------------------------------------------
// Edges — near-invisible at rest, brighten only for hover/selection/activity.
// ---------------------------------------------------------------------------

export const EDGE_BASE = "rgba(96, 130, 175, 0.05)";
export const EDGE_LIT = "rgba(140, 190, 245, 0.55)";
export const EDGE_ACTIVE = "rgba(255, 255, 255, 0.75)";
export const EDGE_HIGHLIGHT = EDGE_LIT;
export const PARTICLE_COLOR = "#7dd3fc";
export const EXECUTION_PARTICLE_COLOR = "#ffffff";

/** Hex-only counterparts of the rgba edge colors above, for THREE.Color
 * (which doesn't reliably parse rgba-with-alpha strings) — the WebGL layer
 * applies alpha separately via vertex-color scaling instead. */
export const EDGE_BASE_HEX = "#6082af";
export const EDGE_LIT_HEX = "#8cbef5";
export const EDGE_ACTIVE_HEX = "#ffffff";

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

/** Deterministic 1-3px radius for a "normal" node — stable per id so it
 * doesn't flicker in size across renders. */
export function normalNodeRadius(id: string): number {
  const [min, max] = NODE_RADIUS.normal;
  return min + (hashString(id) % 100) / 100 * (max - min);
}

/** Deterministic subtle opacity variation for a "normal" node. */
export function normalNodeOpacity(id: string): number {
  const [min, max] = NEUTRAL_NODE_OPACITY_RANGE;
  return min + ((hashString(id) >> 3) % 100) / 100 * (max - min);
}

/** The muted lens accents used for filter chips / legend swatches, and the
 * base fill color for a node before opacity/state adjustments are applied. */
export function nodeColor(type: string, accent: boolean, isHub: boolean): string {
  if (isHub) return HUB_NODE;
  if (accent && ACCENT_COLORS[type]) return ACCENT_COLORS[type];
  return NEUTRAL_NODE;
}

export function zoomLevelFor(scale: number): SemanticZoomLevel {
  if (scale < 0.25) return "galaxy";
  if (scale < 0.55) return "cluster";
  if (scale < 1.1) return "region";
  if (scale < 2.6) return "neighborhood";
  return "detail";
}

/** Whether a node's label should ever be drawn at this zoom level — the
 * brief's "no label explosion" constraint. Hubs earn a label one level
 * earlier than leaf nodes. */
export function labelsVisibleAt(level: SemanticZoomLevel, isHub: boolean): boolean {
  if (level === "galaxy") return false;
  if (level === "cluster") return isHub;
  if (level === "region") return isHub;
  return true;
}
