"use client";

import { useMemo, useState } from "react";
import { FileText, Folder, LayoutGrid, MessageSquare, MoreHorizontal, Play, type LucideIcon } from "lucide-react";
import type { ContinueItem, ContinueItemType } from "@/lib/mission-control/types";
import { selectContinueItems } from "@/lib/mission-control/selectors";
import { cn } from "@/lib/utils";
import { MissionPanel, PanelLink } from "./MissionPanel";

const tabs: Array<{ id: ContinueItemType; label: string }> = [
  { id: "project", label: "Projects" },
  { id: "conversation", label: "Conversations" },
  { id: "file", label: "Files" },
  { id: "workspace", label: "Workspaces" },
];

const iconMap: Record<ContinueItemType, LucideIcon> = {
  project: Folder,
  conversation: MessageSquare,
  file: FileText,
  workspace: LayoutGrid,
};

export function ContinueWork({ items }: { items: ContinueItem[] }) {
  const [activeTab, setActiveTab] = useState<ContinueItemType>("project");
  const filtered = useMemo(() => selectContinueItems(items, activeTab), [activeTab, items]);

  return (
    <div id="continue-work" className="h-full scroll-mt-28">
      <MissionPanel
        title="Continue Where You Left Off"
        action={<PanelLink href="/projects">View all</PanelLink>}
        className="h-full"
        contentClassName="p-0"
      >
        <div className="flex min-w-0 gap-1 overflow-x-auto border-b border-white/[0.07] px-3" role="tablist" aria-label="Recent work type">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={cn(
                "relative h-10 shrink-0 px-3 text-[10px] font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-violet-400/60",
                activeTab === tab.id ? "text-white" : "text-[#8894a5] hover:text-[#d7deea]"
              )}
            >
              {tab.label}
              {activeTab === tab.id ? <span className="absolute inset-x-2 bottom-0 h-0.5 bg-violet-500" /> : null}
            </button>
          ))}
        </div>
        {filtered.length === 0 ? (
          <div className="p-8 text-center text-[11px] text-[#8793a5]">No recent {activeTab} activity.</div>
        ) : (
          <ul role="list" className="divide-y divide-white/[0.07]">
            {filtered.slice(0, 5).map((item) => {
              const Icon = iconMap[item.type];
              return (
                <li key={item.id} className="group flex items-center gap-3 px-4 py-3 transition-colors hover:bg-white/[0.025]">
                  <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-violet-400/20 bg-violet-500/10 text-violet-300">
                    <Icon className="h-4 w-4 stroke-[1.6]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[11px] font-medium text-[#f0f3f8]">{item.title}</div>
                    <div className="mt-0.5 flex min-w-0 items-center gap-2 text-[9px] text-[#7f8b9c]">
                      <span className="truncate">{item.context}</span><span>·</span><span className="shrink-0">{item.lastActivity}</span>
                    </div>
                  </div>
                  <span className="hidden text-[9px] text-[#8793a5] sm:block">{item.status}</span>
                  <a href={item.href} aria-label={`Resume ${item.title}`} className="flex h-8 items-center gap-1.5 rounded-md border border-violet-400/50 px-3 text-[10px] font-medium text-violet-200 outline-none hover:bg-violet-500/12 focus-visible:ring-2 focus-visible:ring-violet-400/60">
                    <Play className="h-3 w-3" /> Resume
                  </a>
                  <button type="button" aria-label={`More options for ${item.title}`} className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md text-[#778497] outline-none hover:bg-white/[0.05] hover:text-white focus-visible:ring-2 focus-visible:ring-violet-400/60"><MoreHorizontal className="h-3.5 w-3.5" /></button>
                </li>
              );
            })}
          </ul>
        )}
      </MissionPanel>
    </div>
  );
}
