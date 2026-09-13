"use client";

import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Agent } from "@/types";
import { StatusDot, type Status } from "./primitives";

function statusOf(agent: Agent): Status {
  return (["online", "busy", "idle", "offline"] as const).includes(agent.status) ? agent.status : "offline";
}

/**
 * Switching agents is the most frequent action in Sentinel, so it is one
 * click from anywhere in the conversation. The dropdown shows only what
 * distinguishes one agent from another: status, role, runtime.
 */
export function AgentSelector({ agents, activeAgent, onSelect }: {
  agents: Agent[];
  activeAgent: Agent | undefined;
  onSelect: (agentId: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onPointerDown = (event: MouseEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => { if (event.key === "Escape") setOpen(false); };
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={containerRef}>
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex items-center gap-2 rounded-lg px-2 py-1.5 text-[15px] font-medium text-[--foreground] transition-colors hover:bg-[--muted] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
      >
        {activeAgent ? <StatusDot status={statusOf(activeAgent)} /> : null}
        <span className="truncate">{activeAgent?.name ?? "Select an agent"}</span>
        <ChevronDown className="h-4 w-4 text-[--muted-foreground]" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute left-0 z-40 mt-1 w-[19rem] overflow-hidden rounded-xl bg-[--card] py-1 shadow-[var(--shadow-lg)]"
        >
          {agents.length === 0 ? (
            <p className="px-3 py-3 text-[13px] text-[--muted-foreground]">No agents are available to you.</p>
          ) : agents.map((agent) => {
            const selected = agent.id === activeAgent?.id;
            return (
              <button
                key={agent.id}
                role="option"
                aria-selected={selected}
                onClick={() => { onSelect(agent.id); setOpen(false); }}
                className={cn(
                  "flex w-full items-center gap-3 px-3 py-2 text-left transition-colors hover:bg-[--muted]",
                  selected && "bg-[--muted]",
                )}
              >
                <StatusDot status={statusOf(agent)} />
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-[--foreground]">{agent.name}</span>
                  <span className="block truncate text-[12px] text-[--muted-foreground]">
                    {agent.role}{agent.model ? ` · ${agent.model}` : ""}
                  </span>
                </span>
                {selected ? <Check className="h-4 w-4 text-[--primary]" /> : null}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
