"use client";

import { useEffect } from "react";
import { X } from "lucide-react";
import { useShellStore } from "@/store/useShellStore";
import { ENTITY_TOKEN, IconButton, type EntityType } from "./primitives";

/**
 * The contextual inspector. It slides in when something is selected and gives
 * the width back the moment it closes — Sentinel has no permanent right rail.
 * Content is supplied by whichever surface opened it.
 */
export function ContextInspector({ children }: { children?: React.ReactNode }) {
  const { inspector, closeInspector } = useShellStore();

  useEffect(() => {
    if (!inspector) return;
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") closeInspector(); };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [inspector, closeInspector]);

  if (!inspector) return null;

  const accent = ENTITY_TOKEN[inspector.type as EntityType] ?? "var(--entity-external)";

  return (
    <aside
      aria-label={`${inspector.type} inspector`}
      className="flex w-[22rem] shrink-0 flex-col border-l border-[--border] bg-[--card]"
    >
      <header className="flex items-center gap-2 px-4 py-3">
        <span className="h-2 w-2 rounded-full" style={{ background: accent }} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-[15px] text-[--foreground]">{inspector.label}</p>
          <p className="text-[12px] capitalize text-[--muted-foreground]">{inspector.type}</p>
        </div>
        <IconButton label="Close inspector" onClick={closeInspector}><X className="h-4 w-4" /></IconButton>
      </header>
      <div className="min-h-0 flex-1 overflow-y-auto px-4 pb-4">
        {children ?? (
          <p className="text-[13px] leading-relaxed text-[--muted-foreground]">
            No inspector view is registered for this entity type yet.
          </p>
        )}
      </div>
    </aside>
  );
}
