"use client";

import { useEffect, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import { EntityChip, type EntityType } from "./primitives";

export interface ContextEntry {
  type: EntityType;
  label: string;
  value: string | null;
  /** Opens the entity when it exists. Absent for unresolved context. */
  onOpen?: () => void;
}

/**
 * Sentinel's contextual awareness, in one line. The details live behind a
 * click — context never permanently occupies the conversation surface.
 */
export function ContextChip({ summary, entries }: { summary: string; entries: ContextEntry[] }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onPointerDown);
    return () => document.removeEventListener("mousedown", onPointerDown);
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        className="flex items-center gap-1 rounded-lg px-2 py-1.5 text-[13px] text-[--muted-foreground] transition-colors hover:bg-[--muted] hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
      >
        <span className="truncate">{summary}</span>
        <ChevronDown className="h-3.5 w-3.5" />
      </button>

      {open ? (
        <div className="absolute left-0 z-40 mt-1 w-[22rem] rounded-xl bg-[--card] p-2 shadow-[var(--shadow-lg)]">
          {entries.map((entry) => (
            <div key={`${entry.type}-${entry.label}`} className="flex items-center justify-between gap-3 px-1 py-1.5">
              <span className="text-[12px] uppercase tracking-wide text-[--muted-foreground]">{entry.label}</span>
              {entry.value ? (
                <EntityChip type={entry.type} label={entry.value} onClick={entry.onOpen} />
              ) : (
                <span className="text-[13px] text-[--muted-foreground]">Not set</span>
              )}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}
