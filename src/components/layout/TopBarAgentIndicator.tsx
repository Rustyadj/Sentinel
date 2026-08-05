"use client";

import { Bot, ChevronDown } from "lucide-react";
import { useAgentStore } from "@/store/useAgentStore";
import { cn } from "@/lib/utils";

const STATUS_DOT: Record<string, string> = {
  online: "bg-emerald-400",
  busy: "bg-amber-400",
  idle: "bg-sky-400",
  offline: "bg-slate-500",
};

/** Which agent(s) the workspace is currently talking to — reads the same
 * global useAgentStore the chat multi-select picker writes to, so this
 * always reflects reality rather than a separate copy of "active agent."
 * Open state is controlled by TopBar so only one top-bar menu is open at
 * a time. */
export function TopBarAgentIndicator({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const agents = useAgentStore((state) => state.agents);
  const activeAgentIds = useAgentStore((state) => state.activeAgents);

  const activeAgents = agents.filter((a) => activeAgentIds.includes(a.id));
  const primary = activeAgents[0];

  return (
    <div className="relative hidden sm:block">
      <button
        type="button"
        onClick={() => onOpenChange(!open)}
        aria-label="Active agents"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex h-9 items-center gap-2 rounded-xl border border-white/[0.055] bg-white/[0.035] px-3 text-[11px] text-[#d5dbe5] hover:border-white/[0.11]"
      >
        <Bot className="h-3.5 w-3.5 text-violet-300" />
        {primary ? (
          <span className="max-w-[110px] truncate">
            {primary.name}
            {activeAgents.length > 1 ? ` +${activeAgents.length - 1}` : ""}
          </span>
        ) : (
          <span className="text-[#7e8a9c]">No agent</span>
        )}
        <ChevronDown className="h-3.5 w-3.5 text-[#6e7a8c]" />
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="Active agents"
          className="absolute right-0 top-full z-50 mt-2 w-56 overflow-hidden rounded-xl border border-white/[0.08] bg-[#0a1420]/98 py-1 shadow-2xl"
        >
          {activeAgents.map((agent) => (
            <li key={agent.id} role="option" aria-selected>
              <div className="flex items-center gap-2.5 px-3 py-2 text-[11px] text-[#c5cedb]">
                <span className={cn("h-1.5 w-1.5 rounded-full", STATUS_DOT[agent.status] ?? "bg-slate-500")} />
                <span className="min-w-0 flex-1 truncate">{agent.name}</span>
                <span className="shrink-0 text-[9px] text-[#66758c]">{agent.model}</span>
              </div>
            </li>
          ))}
          {activeAgents.length === 0 ? (
            <li className="px-3 py-2 text-[10px] text-[#718095]">No agents active in this chat</li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
