"use client";

import { useEffect, useState } from "react";
import { Activity, Brain, CheckSquare, FileText, X } from "lucide-react";
import { useAppStore } from "@/store/useAppStore";
import type { MissionControlData } from "@/lib/mission-control/types";
import { missionControlService } from "@/lib/mission-control/service";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";

const TABS = [
  { id: "activity" as const, label: "Activity", Icon: Activity },
  { id: "memory" as const, label: "Memory", Icon: Brain },
  { id: "files" as const, label: "Files", Icon: FileText },
  { id: "tasks" as const, label: "Tasks", Icon: CheckSquare },
];

export function RightPanel() {
  const { rightPanelTab, setRightPanelTab, setRightPanelOpen } = useAppStore();
  const [data, setData] = useState<MissionControlData | null>(null);
  const [error, setError] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    missionControlService.load(controller.signal).then(setData).catch((reason: unknown) => {
      if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Operational data is unavailable");
    });
    return () => controller.abort();
  }, []);

  return (
    <aside className="flex h-full w-64 shrink-0 flex-col border-l border-[--border] bg-[--panel]">
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-[--border] px-3">
        <div className="flex items-center gap-1">
          {TABS.map(({ id, label, Icon }) => (
            <button key={id} type="button" onClick={() => setRightPanelTab(id)} className={cn("flex items-center gap-1 rounded px-2 py-1.5 text-xs transition-colors", rightPanelTab === id ? "bg-[--accent] text-[--foreground]" : "text-[--muted-foreground] hover:text-[--foreground]")}>
              <Icon className="h-3 w-3" /><span className="hidden lg:inline">{label}</span>
            </button>
          ))}
        </div>
        <button type="button" aria-label="Close context panel" onClick={() => setRightPanelOpen(false)} className="text-[--muted-foreground] transition-colors hover:text-[--foreground]"><X className="h-3.5 w-3.5" /></button>
      </div>

      <ScrollArea className="flex-1">
        {rightPanelTab === "activity" ? <ActivityTab data={data} error={error} /> : null}
        {rightPanelTab === "memory" ? <UnconnectedTab title="Memory" detail="Open Knowledge for database-backed memories. This context rail has no live memory adapter." href="/memory" /> : null}
        {rightPanelTab === "files" ? <UnconnectedTab title="Files" detail="No live file provider is connected to this context rail." /> : null}
        {rightPanelTab === "tasks" ? <UnconnectedTab title="Tasks" detail="Open Workflows for database-backed tasks. This context rail does not substitute sample tasks." href="/workflows" /> : null}
      </ScrollArea>
    </aside>
  );
}

function ActivityTab({ data, error }: { data: MissionControlData | null; error: string }) {
  if (error) return <UnconnectedTab title="Activity unavailable" detail={error} />;
  if (!data) return <div className="p-4 text-xs text-[--muted-foreground]">Loading live activity…</div>;
  return (
    <div className="space-y-4 p-3">
      <div>
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-[--muted-foreground]">
          <span>Recent activity</span><SourceState state={data.sources.feed.state} />
        </div>
        {data.feed.length ? data.feed.slice(0, 8).map((event) => (
          <a key={event.id} href={event.href} className="block border-b border-[--border] py-2 last:border-0 hover:text-violet-200">
            <div className="truncate text-xs text-[--foreground]">{event.event}</div>
            <div className="mt-0.5 truncate text-[10px] text-[--muted-foreground]">{event.actor} · {event.timestamp}</div>
          </a>
        )) : <p className="py-3 text-[11px] text-[--muted-foreground]">No audit or knowledge events were found.</p>}
      </div>

      <div>
        <div className="mb-2 flex items-center justify-between text-[10px] uppercase tracking-widest text-[--muted-foreground]">
          <span>Agent registry</span><SourceState state={data.sources.agents.state} />
        </div>
        {data.agents.length ? data.agents.map((agent) => (
          <a key={agent.id} href={agent.href} className="flex items-center gap-2 border-b border-[--border] py-2 last:border-0">
            <span className="flex h-6 w-6 items-center justify-center rounded-full bg-violet-500/10 text-[9px] text-violet-200">{agent.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
            <span className="min-w-0 flex-1"><span className="block truncate text-xs text-[--foreground]">{agent.name}</span><span className="block truncate text-[10px] text-[--muted-foreground]">{agent.role}</span></span>
            <span className="text-[9px] capitalize text-[--muted-foreground]">{agent.status}</span>
          </a>
        )) : <p className="py-3 text-[11px] text-[--muted-foreground]">No agents are registered in an accessible workspace.</p>}
      </div>
    </div>
  );
}

function SourceState({ state }: { state: MissionControlData["sources"]["feed"]["state"] }) {
  return <span className={cn("rounded border px-1.5 py-0.5 text-[8px]", state === "live" ? "border-emerald-400/30 text-emerald-300" : state === "stale" ? "border-amber-400/30 text-amber-200" : "border-slate-400/25 text-slate-300")}>{state}</span>;
}

function UnconnectedTab({ title, detail, href }: { title: string; detail: string; href?: string }) {
  return (
    <div className="p-4">
      <div className="flex items-center justify-between"><h2 className="text-xs font-medium text-[--foreground]">{title}</h2><SourceState state="unavailable" /></div>
      <p className="mt-3 text-[11px] leading-5 text-[--muted-foreground]">{detail}</p>
      {href ? <a href={href} className="mt-4 inline-flex rounded border border-violet-400/30 px-2.5 py-1.5 text-[10px] text-violet-200">Open source</a> : null}
    </div>
  );
}
