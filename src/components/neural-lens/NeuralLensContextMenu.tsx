"use client";

import { useEffect, useRef } from "react";
import { Crosshair, Copy, ExternalLink } from "lucide-react";
import type { LensNode } from "./types";

export interface ContextMenuTarget {
  node: LensNode;
  x: number;
  y: number;
}

interface NeuralLensContextMenuProps {
  target: ContextMenuTarget | null;
  onClose: () => void;
  onFocus: (node: LensNode) => void;
  onOpenModule: (node: LensNode) => void;
}

/** Right-click menu for a graph node — the brief's "context menu" affordance.
 * Closes on outside click, Escape, or scroll (a stale screen-space menu
 * anchored to a 3D point would drift as the camera moves). */
export function NeuralLensContextMenu({ target, onClose, onFocus, onOpenModule }: NeuralLensContextMenuProps) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!target) return;
    const handlePointerDown = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) onClose();
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handlePointerDown);
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("wheel", onClose, { passive: true });
    return () => {
      window.removeEventListener("mousedown", handlePointerDown);
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("wheel", onClose);
    };
  }, [target, onClose]);

  if (!target) return null;
  const { node, x, y } = target;

  return (
    <div
      ref={ref}
      className="pointer-events-auto absolute z-40 w-48 rounded-lg border border-white/10 bg-[#0a0f1a]/95 py-1 text-[11px] text-white/80 shadow-2xl backdrop-blur-xl"
      style={{ left: x, top: y }}
    >
      <div className="truncate border-b border-white/8 px-3 py-1.5 text-[9px] uppercase tracking-[0.14em] text-white/35">
        {node.label}
      </div>
      <button
        onClick={() => {
          onFocus(node);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/8"
      >
        <Crosshair className="h-3.5 w-3.5 text-white/40" />
        Focus
      </button>
      <button
        onClick={() => {
          onOpenModule(node);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/8"
      >
        <ExternalLink className="h-3.5 w-3.5 text-white/40" />
        Open module
      </button>
      <button
        onClick={() => {
          void navigator.clipboard.writeText(node.id);
          onClose();
        }}
        className="flex w-full items-center gap-2 px-3 py-1.5 text-left hover:bg-white/8"
      >
        <Copy className="h-3.5 w-3.5 text-white/40" />
        Copy node id
      </button>
    </div>
  );
}
