// Neural Lens — operator-facing render settings.
//
// Kept in its own module (free of Three.js) so the store, the control rail,
// and the renderer can all share one definition without the settings type
// dragging WebGL into bundles that only need to read a boolean.

export interface GlobeSettings {
  /** 0..1 — the fraction of the dust field and fine edges drawn. Thins the
   * field deterministically; it never reshuffles or re-lays-out anything. */
  density: number;
  showLabels: boolean;
  showEdges: boolean;
  /** Bloom behind hubs, the selection, and the atmosphere rim. */
  glow: boolean;
  /** Breathing drift, activity pulses, and active-path traversal. */
  animate: boolean;
  depthFog: boolean;
}

export const DEFAULT_GLOBE_SETTINGS: GlobeSettings = {
  density: 0.72,
  showLabels: true,
  showEdges: true,
  glow: true,
  animate: true,
  depthFog: true,
};

/** Coerce persisted/partial settings into a complete, in-range object. */
export function normalizeGlobeSettings(value: Partial<GlobeSettings> | null | undefined): GlobeSettings {
  if (!value) return DEFAULT_GLOBE_SETTINGS;
  const density = typeof value.density === "number" && Number.isFinite(value.density)
    ? Math.min(1, Math.max(0.2, value.density))
    : DEFAULT_GLOBE_SETTINGS.density;
  return {
    density,
    showLabels: value.showLabels ?? DEFAULT_GLOBE_SETTINGS.showLabels,
    showEdges: value.showEdges ?? DEFAULT_GLOBE_SETTINGS.showEdges,
    glow: value.glow ?? DEFAULT_GLOBE_SETTINGS.glow,
    animate: value.animate ?? DEFAULT_GLOBE_SETTINGS.animate,
    depthFog: value.depthFog ?? DEFAULT_GLOBE_SETTINGS.depthFog,
  };
}
