// Sentinel's dark-first design system (see DESIGN.md at the repo root),
// carried over as plain constants rather than a light/dark ThemeProvider —
// Sentinel OS is dark-first by design, not theme-adaptive, so the app
// doesn't need to track the device's color scheme at all.
export const colors = {
  background: "#08090b",
  canvas: "#0a0b0e",
  panel: "#0e1014",
  card: "#101318",
  border: "#1c1f24",
  cardBorder: "#20242b",
  textPrimary: "#e8eaed",
  textSecondary: "#9ca3af",
  textMuted: "#6b7280",
  accent: "#7c6cf6",
  danger: "#ef4444",
  warning: "#f59e0b",
  success: "#10b981",
  info: "#38bdf8",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
} as const;

export const radius = {
  sm: 6,
  md: 8,
  lg: 12,
  pill: 999,
} as const;
