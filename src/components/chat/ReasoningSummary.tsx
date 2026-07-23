"use client";

import { useState } from "react";
import { ChevronRight, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

interface ReasoningSummaryProps {
  /** Approved reasoning summary — never raw chain-of-thought. */
  summary: string;
}

/** Collapsible, approved reasoning/process summary attached to an agent message. */
export function ReasoningSummary({ summary }: ReasoningSummaryProps) {
  const [expanded, setExpanded] = useState(false);

  return (
    <div className="mt-1.5">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        className="flex items-center gap-1 rounded text-[10px] text-[#697084] outline-none transition-colors hover:text-[#c8cdd8] focus-visible:ring-2 focus-visible:ring-indigo-400/60"
      >
        <ChevronRight
          className={cn("h-3 w-3 transition-transform", expanded && "rotate-90")}
        />
        <Sparkles className="h-2.5 w-2.5 text-violet-400/80" />
        Process summary
      </button>
      {expanded && (
        <div className="mt-1.5 rounded-md border border-violet-400/15 bg-violet-500/[0.06] px-3 py-2 text-[11px] leading-relaxed text-[#9aa1b4]">
          {summary}
        </div>
      )}
    </div>
  );
}
