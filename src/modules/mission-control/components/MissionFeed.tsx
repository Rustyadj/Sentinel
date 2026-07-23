"use client";

import { useMemo, useState } from "react";
import { ArrowUpRight, Filter } from "lucide-react";
import type { FeedScope, MissionFeedItem } from "@/lib/mission-control/types";
import { selectMissionFeed } from "@/lib/mission-control/selectors";
import { cn } from "@/lib/utils";
import { MissionPanel, StatusDot } from "./MissionPanel";

const filters: Array<{ id: FeedScope; label: string }> = [
  { id: "all", label: "All" }, { id: "agents", label: "Agents" }, { id: "projects", label: "Projects" },
  { id: "workspaces", label: "Workspaces" }, { id: "system", label: "System" }, { id: "organization", label: "Organization" },
];

export function MissionFeed({ items }: { items: MissionFeedItem[] }) {
  const [scope, setScope] = useState<FeedScope>("all");
  const filtered = useMemo(() => selectMissionFeed(items, scope), [items, scope]);
  return (
    <MissionPanel
      title="Mission Feed"
      className="h-full"
      action={<span className="hidden items-center gap-1.5 text-[9px] text-[#7f8c9f] sm:flex"><Filter className="h-3 w-3" />Operational activity</span>}
      contentClassName="p-0"
    >
      <div className="flex gap-1 overflow-x-auto border-b border-white/[0.07] p-2" role="toolbar" aria-label="Mission feed filters">
        {filters.map((filter) => (
          <button key={filter.id} type="button" aria-pressed={scope === filter.id} onClick={() => setScope(filter.id)} className={cn("h-8 shrink-0 rounded-md border px-3 text-[9px] font-medium outline-none focus-visible:ring-2 focus-visible:ring-violet-400/60", scope === filter.id ? "border-violet-400/55 bg-violet-600 text-white" : "border-white/[0.09] bg-white/[0.025] text-[#a6b1c1] hover:text-white")}>{filter.label}</button>
        ))}
      </div>
      {filtered.length === 0 ? <div className="p-8 text-center text-[10px] text-[#7f8b9d]">No events in this feed yet.</div> : (
        <ul className="divide-y divide-white/[0.07]" role="list">
          {filtered.slice(0, 7).map((item) => (
            <li key={item.id} className="group flex items-center gap-3 px-4 py-3 hover:bg-white/[0.022]">
              <StatusDot tone={item.tone} />
              <div className="min-w-0 flex-1"><div className="truncate text-[10px] text-[#e2e7ef]">{item.event}</div><div className="mt-0.5 text-[8px] text-[#738095]">{item.source} · by {item.actor}</div></div>
              <time className="shrink-0 text-[8px] text-[#738095]">{item.timestamp}</time>
              <a href={item.href} aria-label={`Open event: ${item.event}`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded text-[#7f8b9c] outline-none hover:bg-white/[0.05] hover:text-violet-300 focus-visible:ring-2 focus-visible:ring-violet-400/60"><ArrowUpRight className="h-3.5 w-3.5" /></a>
            </li>
          ))}
        </ul>
      )}
    </MissionPanel>
  );
}
