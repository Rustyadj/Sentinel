"use client";

import { useEffect, useRef } from "react";
import type { PhoneTurn } from "../api";

export function Transcript({ turns, agent, other, live = false }: { turns: PhoneTurn[]; agent: string; other: string; live?: boolean }) {
  const end = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (live) end.current?.scrollIntoView({ block: "nearest" });
  }, [turns.length, live]);

  if (turns.length === 0) {
    return <p className="text-[12px] text-[--muted-foreground]">{live ? "Waiting for the conversation to start…" : "No transcript was recorded."}</p>;
  }
  return (
    <ol className="max-h-72 space-y-2 overflow-y-auto pr-1" aria-live={live ? "polite" : undefined}>
      {turns.map((turn) => (
        <li key={turn.id} className="text-[13px] leading-relaxed">
          <span className={turn.role === "agent" ? "font-medium text-[--primary]" : "font-medium text-[--canvas-foreground]"}>
            {turn.role === "agent" ? agent : other}
          </span>
          <span className="text-[--muted-foreground]"> — </span>
          <span className="text-[--canvas-foreground]">{turn.text}</span>
        </li>
      ))}
      <div ref={end} />
    </ol>
  );
}
