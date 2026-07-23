import { Activity, AudioLines, ChevronRight, Cpu, MicOff } from "lucide-react";
import type { AgentOperation, OperationalStatus } from "@/lib/mission-control/types";
import { MissionPanel, PanelLink, StatusDot } from "./MissionPanel";

const statusTone: Record<OperationalStatus, "positive" | "warning" | "critical" | "neutral"> = {
  online: "positive", busy: "warning", idle: "neutral", offline: "neutral", error: "critical",
};

export function AgentOperations({ agents }: { agents: AgentOperation[] }) {
  return (
    <MissionPanel title="AI Workforce" action={<PanelLink href="/agents">Manage workforce</PanelLink>} contentClassName="p-0" className="h-full">
      <ul className="divide-y divide-white/[0.07]" role="list">
        {agents.map((agent) => (
          <li key={agent.id} className="grid gap-3 px-4 py-3 hover:bg-white/[0.022] md:grid-cols-[165px_minmax(0,1fr)_210px] md:items-center">
            <div className="flex min-w-0 items-center gap-2.5">
              <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-violet-400/30 bg-violet-500/10 text-[10px] font-semibold text-violet-200">{agent.name.split(" ").map((part) => part[0]).join("").slice(0, 2)}</span>
              <span className="min-w-0"><span className="block truncate text-[11px] font-medium text-[#f1f4f8]">{agent.name}</span><span className="mt-0.5 flex items-center gap-1.5 text-[8px] capitalize text-[#8996a8]"><StatusDot tone={statusTone[agent.status]} pulse={agent.status === "busy"} />{agent.status} · {agent.model}</span></span>
            </div>

            <div className="min-w-0">
              <div className="flex items-center justify-between gap-3"><span className="truncate text-[10px] text-[#d8dee8]" title={agent.currentTask}>{agent.currentTask}</span><span className="shrink-0 text-[8px] text-[#7e8b9d]">{agent.progress === null ? "—" : `${agent.progress}%`}</span></div>
              <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-white/[0.08]"><span className="block h-full bg-violet-500" style={{ width: `${agent.progress ?? 0}%` }} /></div>
              <div className="mt-1 truncate text-[8px] text-[#748195]">{agent.role} · {agent.context}</div>
            </div>

            <div className="flex items-center gap-3 md:justify-end">
              <span className="flex min-w-16 items-center gap-1 text-[8px] capitalize text-[#9ca8b8]">{agent.voiceState === "silent" || agent.voiceState === "unavailable" ? <MicOff className="h-3 w-3 text-[#657286]" /> : <AudioLines className="h-3 w-3 text-violet-300" />}{agent.voiceState}</span>
              <span className="text-[8px] leading-4 text-[#8794a6]"><span className="flex items-center gap-1"><Cpu className="h-3 w-3" />{agent.health.cpu === null ? "—" : `${agent.health.cpu}%`} / {agent.health.memory}</span><span className="flex items-center gap-1"><Activity className="h-3 w-3" />{agent.health.runtime}</span></span>
              <span className="ml-auto text-[9px] tabular-nums text-[#d8dee7] md:ml-0">${agent.costToday.toFixed(2)}</span>
              <a href={agent.href} aria-label={`Open ${agent.name} details`} className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-white/[0.1] text-[#98a4b5] outline-none hover:border-violet-400/40 hover:text-violet-200 focus-visible:ring-2 focus-visible:ring-violet-400/60"><ChevronRight className="h-3.5 w-3.5" /></a>
            </div>
          </li>
        ))}
      </ul>
    </MissionPanel>
  );
}
