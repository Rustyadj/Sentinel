"use client";

import { useState } from "react";
import {
  Archive,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  FileCode2,
  ListChecks,
  Network,
  PanelRightClose,
  Scale,
  TerminalSquare,
} from "lucide-react";
import { cn } from "@/lib/utils";
import type { AgentActivityEntry } from "@/store/useCollaborationStore";
import type { CollaborationRoomController } from "./useCollaborationRoom";

const STATUS_COLOR: Record<string, string> = {
  RUNNING: "bg-cyan-400",
  WAITING_REVIEW: "bg-amber-400",
  COMPLETED: "bg-emerald-400",
  BLOCKED: "bg-red-400",
  CHANGES_REQUESTED: "bg-rose-400",
  PLANNED: "bg-slate-500",
  QUEUED: "bg-sky-400",
  CANCELLED: "bg-slate-600",
};

function clock(at: string): string {
  return new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "America/Chicago" }).format(new Date(at));
}

export function CollaborationLane({ room }: { room: CollaborationRoomController }) {
  const [activityAgentId, setActivityAgentId] = useState(room.participants[0]?.agentId ?? "");
  const taskCounts = room.tasks.reduce<Record<string, number>>((counts, task) => ({ ...counts, [task.status]: (counts[task.status] ?? 0) + 1 }), {});
  const activity = room.activity.filter((entry) => entry.agentId === activityAgentId);

  return (
    <aside className="flex h-full w-[318px] shrink-0 flex-col border-l border-[#17283b] bg-[#07101a] shadow-[-18px_0_50px_rgba(0,0,0,0.22)]" aria-label="Collaboration lane">
      <div className="flex h-12 shrink-0 items-center gap-2 border-b border-white/[0.07] px-3.5">
        <Network className="h-3.5 w-3.5 text-cyan-300" />
        <span className="text-[10px] font-semibold uppercase tracking-[0.17em] text-[#c5d0dc]">Collaboration</span>
        <button type="button" onClick={() => room.setLaneOpen(false)} aria-label="Close collaboration lane" className="ml-auto rounded-md p-1.5 text-[#64758a] outline-none hover:bg-white/[0.06] hover:text-white focus-visible:ring-1 focus-visible:ring-cyan-300/50"><PanelRightClose className="h-3.5 w-3.5" /></button>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-5">
        <LaneSection title="Active" icon={CircleDot} defaultOpen>
          <div className="space-y-1.5">
            {room.participants.map((participant) => (
              <button key={participant.agentId} type="button" onClick={() => room.setSelectedParticipantId(participant.agentId)} className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2 py-2 text-left outline-none hover:border-cyan-300/20 focus-visible:ring-1 focus-visible:ring-cyan-300/50">
                <span className={cn("h-1.5 w-1.5 rounded-full", participant.health === "BUSY" ? "bg-amber-400" : participant.health === "DISCONNECTED" ? "bg-slate-500" : "bg-emerald-400")} />
                <span className="min-w-0 flex-1"><span className="block truncate text-[10.5px] text-[#d8e1ea]">{participant.name}</span><span className="block truncate text-[9px] text-[#67798f]">{participant.status}{participant.activeTaskId ? ` · ${participant.activeTaskId}` : ""}</span></span>
                <ChevronRight className="h-3 w-3 text-[#52647a]" />
              </button>
            ))}
          </div>
          <div className="mt-3 rounded-lg border border-white/[0.06] bg-black/15 p-2.5">
            <label className="flex items-center gap-1.5 text-[9px] uppercase tracking-[0.13em] text-[#697b91]"><TerminalSquare className="h-3 w-3" /> Agent activity</label>
            <select value={activityAgentId} onChange={(event) => setActivityAgentId(event.target.value)} className="mt-2 h-7 w-full rounded-md border border-white/[0.07] bg-[#0b1622] px-2 text-[9.5px] text-[#afbdcb] outline-none focus:border-cyan-300/25" aria-label="Activity agent">
              {room.participants.map((participant) => <option key={participant.agentId} value={participant.agentId}>{participant.name}</option>)}
            </select>
            <ActivityTimeline entries={activity} />
          </div>
        </LaneSection>

        <LaneSection title="Tasks" icon={ListChecks} defaultOpen badge={String(room.tasks.length)}>
          <div className="mb-2 flex flex-wrap gap-1">
            {Object.entries(taskCounts).map(([status, count]) => <span key={status} className="rounded border border-white/[0.06] bg-white/[0.025] px-1.5 py-0.5 text-[8px] text-[#8293a7]">{status.replaceAll("_", " ")} {count}</span>)}
          </div>
          <div className="space-y-1.5">
            {room.tasks.map((task) => (
              <button key={task.id} type="button" onClick={() => room.setSelectedTaskId(task.id)} className="w-full rounded-lg border border-white/[0.06] bg-white/[0.02] p-2.5 text-left outline-none hover:border-cyan-300/20 focus-visible:ring-1 focus-visible:ring-cyan-300/50">
                <div className="flex items-center gap-1.5"><span className={cn("h-1.5 w-1.5 rounded-full", STATUS_COLOR[task.status] ?? "bg-slate-500")} /><span className="font-mono text-[8.5px] text-cyan-300/70">{task.id}</span><span className="ml-auto text-[8px] text-[#65768b]">{task.status.replaceAll("_", " ")}</span></div>
                <div className="mt-1.5 line-clamp-2 text-[10px] leading-relaxed text-[#c3ceda]">{task.title}</div>
              </button>
            ))}
          </div>
        </LaneSection>

        <LaneSection title="Decisions" icon={Scale} badge={String(room.decisions.length)}>
          <div className="space-y-2">{room.decisions.map((decision) => <div key={decision.id} className="rounded-lg border border-violet-300/10 bg-violet-300/[0.025] p-2.5"><div className="text-[9.5px] font-medium leading-relaxed text-[#cbd5e1]">{decision.decision}</div><div className="mt-1.5 text-[8.5px] leading-relaxed text-[#687b91]">{decision.reason}</div></div>)}</div>
        </LaneSection>

        <LaneSection title="Artifacts" icon={Archive} badge={String(room.artifacts.length)}>
          <div className="space-y-1.5">{room.artifacts.map((artifact) => <button key={artifact.id} type="button" onClick={() => room.setSelectedArtifactId(artifact.id)} className="flex w-full items-center gap-2 rounded-lg border border-white/[0.06] bg-white/[0.02] px-2.5 py-2 text-left outline-none hover:border-cyan-300/20 focus-visible:ring-1 focus-visible:ring-cyan-300/50"><FileCode2 className="h-3.5 w-3.5 shrink-0 text-cyan-300/65" /><span className="min-w-0 flex-1"><span className="block truncate text-[9.5px] text-[#c8d2dd]">{artifact.title}</span><span className="block text-[8.5px] text-[#65768b]">{artifact.type.replaceAll("_", " ")} · {artifact.id}</span></span></button>)}</div>
        </LaneSection>
      </div>
    </aside>
  );
}

function ActivityTimeline({ entries }: { entries: AgentActivityEntry[] }) {
  if (entries.length === 0) return <div className="mt-3 text-[9px] text-[#5f7187]">No execution events yet.</div>;
  return (
    <div className="mt-3 space-y-2">
      {entries.map((entry, index) => (
        <div key={entry.id} className="relative flex gap-2 pl-1">
          {index < entries.length - 1 ? <span className="absolute left-[3px] top-2 h-[calc(100%+8px)] w-px bg-white/[0.07]" /> : null}
          <span className="relative mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-cyan-300/70" />
          <div><div className="text-[9.5px] text-[#aebbc9]"><span className="mr-1.5 font-mono text-[8px] text-[#5f7187]">{clock(entry.at)}</span>{entry.action}</div>{entry.detail ? <div className="mt-0.5 text-[8.5px] leading-relaxed text-[#62748a]">{entry.detail}</div> : null}</div>
        </div>
      ))}
    </div>
  );
}

function LaneSection({ title, icon: Icon, badge, defaultOpen = false, children }: { title: string; icon: typeof Clock3; badge?: string; defaultOpen?: boolean; children: React.ReactNode }) {
  return (
    <details open={defaultOpen} className="group border-b border-white/[0.06] py-3">
      <summary className="flex cursor-pointer list-none items-center gap-2 rounded-md py-1 text-[9.5px] font-semibold uppercase tracking-[0.15em] text-[#8293a7] outline-none focus-visible:ring-1 focus-visible:ring-cyan-300/50"><ChevronDown className="h-3 w-3 -rotate-90 transition-transform group-open:rotate-0" /><Icon className="h-3.5 w-3.5 text-cyan-300/60" />{title}{badge ? <span className="ml-auto rounded bg-white/[0.05] px-1.5 py-0.5 font-mono text-[8px] tracking-normal text-[#72849a]">{badge}</span> : null}</summary>
      <div className="mt-2.5">{children}</div>
    </details>
  );
}
