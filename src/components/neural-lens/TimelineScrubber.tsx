"use client";

import { Clock } from "lucide-react";

const RANGES = ["Now", "1h", "Today", "Week", "Month"] as const;
export type TimeRange = (typeof RANGES)[number];

interface TimelineScrubberProps {
  open: boolean;
  range: TimeRange;
  onRangeChange: (r: TimeRange) => void;
  onClose: () => void;
}

/**
 * Phase D timeline SHELL. The temporal data model (validFrom/validTo/version,
 * temporal-service asOf/between) is real and tested from Phase A, but this UI
 * currently only selects a range and reports it — wiring it to actually
 * reconstruct and re-render historical graph state is the tracked Phase D/E
 * follow-up. Labeled as a shell rather than pretending to time-travel.
 */
export function TimelineScrubber({ open, range, onRangeChange, onClose }: TimelineScrubberProps) {
  if (!open) return null;
  return (
    <div className="pointer-events-auto absolute bottom-12 left-1/2 z-30 flex -translate-x-1/2 items-center gap-3 rounded-xl border border-white/10 bg-[#070c14]/90 px-4 py-2.5 shadow-2xl backdrop-blur-xl">
      <Clock className="h-3.5 w-3.5 text-indigo-300" />
      <div className="flex items-center gap-1">
        {RANGES.map((r) => (
          <button
            key={r}
            onClick={() => onRangeChange(r)}
            className={`rounded-md px-2.5 py-1 text-[10px] transition-colors ${
              range === r ? "bg-indigo-500/20 text-indigo-200" : "text-white/45 hover:bg-white/5"
            }`}
          >
            {r}
          </button>
        ))}
      </div>
      <div className="h-4 w-px bg-white/10" />
      <span className="text-[9px] uppercase tracking-wide text-white/30">Time Map · shell</span>
      <button onClick={onClose} className="text-[10px] text-white/40 hover:text-white">
        close
      </button>
    </div>
  );
}
