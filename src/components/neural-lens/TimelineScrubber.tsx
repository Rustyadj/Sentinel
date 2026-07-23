"use client";

import { Clock, Loader2 } from "lucide-react";

const RANGES = ["Now", "1h", "Today", "Week", "Month"] as const;
export type TimeRange = (typeof RANGES)[number];

interface TimelineScrubberProps {
  open: boolean;
  range: TimeRange;
  onRangeChange: (r: TimeRange) => void;
  onClose: () => void;
  demoMode: boolean;
  loading: boolean;
  /** The reconstructed timestamp currently being shown, or null when live. */
  asOf: Date | null;
}

/**
 * Phase E: real temporal reconstruction. Selecting a range fetches
 * /api/neural/temporal (backed by temporal-service's validFrom/validTo
 * windows from Phase A) and swaps the graph to that historical snapshot.
 * Only meaningful in SCOPED mode — the demo graph has no real temporal
 * history to reconstruct, so it's disabled there rather than pretending to
 * time-travel through fabricated data.
 */
export function TimelineScrubber({
  open,
  range,
  onRangeChange,
  onClose,
  demoMode,
  loading,
  asOf,
}: TimelineScrubberProps) {
  if (!open) return null;
  return (
    <div className="pointer-events-auto absolute bottom-12 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-[#070c14]/90 px-4 py-2.5 shadow-2xl backdrop-blur-xl">
      {loading ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin text-indigo-300" />
      ) : (
        <Clock className="h-3.5 w-3.5 text-indigo-300" />
      )}
      <div className="flex items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r}
            disabled={demoMode && r !== "Now"}
            onClick={() => onRangeChange(r)}
            className={`rounded-md px-2.5 py-1 text-[10px] transition-colors ${
              range === r ? "bg-indigo-500/20 text-indigo-200" : "text-white/45 hover:bg-white/5"
            } ${demoMode && r !== "Now" ? "cursor-not-allowed opacity-30" : ""}`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="h-4 w-px bg-white/10" />
      {demoMode ? (
        <span className="text-[9px] text-white/30">Demo data has no history — switch to Scoped</span>
      ) : asOf ? (
        <span className="text-[9px] uppercase tracking-wide text-amber-300/80">
          {asOf.toLocaleString()}
        </span>
      ) : (
        <span className="text-[9px] uppercase tracking-wide text-white/30">Live</span>
      )}
      <button onClick={onClose} className="text-[10px] text-white/40 hover:text-white">
        close
      </button>
    </div>
  );
}
