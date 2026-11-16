"use client";

import { cn } from "@/lib/utils";
import { VoiceControls } from "@/components/voice/VoiceControls";
import type { OrreryEvent } from "@/lib/orrery/types";

export interface PanelAgent {
  id: string;
  name: string;
  color: string;
  model: string;
  state: "working" | "idle" | "offline";
  detail: string;
  /** True when the agent has a configured live voice. */
  voice: boolean;
}

const STATE_LABEL: Record<PanelAgent["state"], string> = { working: "Working", idle: "Idle", offline: "Offline" };
const TIME = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** Live agents and the real events they have produced: a column beside the graph. */
export function ActivityPanel({ agents, events, followId, onFollow, roomId, onTranscript }: {
  agents: PanelAgent[];
  events: OrreryEvent[];
  followId: string | null;
  onFollow: (agentId: string | null) => void;
  roomId?: string;
  onTranscript: (text: string) => void;
}) {
  const live = agents.filter((a) => a.state === "working").length;
  const byId = new Map(agents.map((a) => [a.id, a]));
  return (
    <aside data-orrery-ui data-activity-panel aria-label="Agent activity" className="m-3 hidden h-[calc(100%-1.5rem)] w-[300px] shrink-0 flex-col overflow-hidden rounded-(--radius-lg) border border-(--border) bg-(--panel) shadow-(--shadow-md) xl:flex">
      <Heading label="Agents" meta={`${live} live`} />
      <ul className="max-h-[46%] shrink-0 space-y-1 overflow-y-auto px-2 pb-2">
        {agents.length === 0 ? <li className="px-2 py-3 text-[12px] text-(--muted-foreground)">No agents registered.</li> : null}
        {agents.map((a) => {
          const active = a.id === followId;
          return (
            <li key={a.id} className={cn("relative rounded-(--radius-md) transition-colors", active ? "bg-(--accent) before:absolute before:inset-y-2.5 before:left-0 before:w-[3px] before:rounded-full before:bg-(--primary)" : "hover:bg-(--muted)")}>
              <button
                type="button"
                onClick={() => onFollow(active ? null : a.id)}
                aria-pressed={active}
                className="w-full rounded-md px-3 py-2 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)"
              >
                <div className="flex items-center gap-2">
                  <i className={cn("h-2.5 w-2.5 shrink-0 rounded-full", a.state !== "working" && "opacity-50")} style={{ background: a.color }} />
                  <span className="truncate text-[13px] font-semibold">{a.name}</span>
                  <span className={cn("ml-auto text-[11px]", a.state === "working" ? "text-(--status-busy)" : "text-(--text-faint)")}>{STATE_LABEL[a.state]}</span>
                </div>
                <p className={cn("mt-1 text-[12px]", a.state === "working" ? "line-clamp-2 text-(--foreground)" : "truncate text-(--muted-foreground)")}>{a.detail}</p>
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-(--text-faint)">{a.model}</p>
              </button>
              {a.voice ? (
                <div className="px-3 pb-2">
                  <VoiceControls agentId={a.id} roomId={roomId} onTranscript={onTranscript} />
                </div>
              ) : null}
            </li>
          );
        })}
      </ul>
      <div className="mx-3 h-px bg-(--border)" />
      <Heading label="Events" meta={String(events.length)} />
      <ol className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-3">
        {events.length === 0 ? <li className="px-2 py-3 text-[12px] text-(--muted-foreground)">No agent activity in the last 15 minutes.</li> : null}
        {events.map((e) => {
          const agent = byId.get(e.agentId);
          return (
            <li key={e.id} className="rounded-md px-3 py-2">
              <div className="flex items-baseline gap-2">
                <span className="truncate text-[12.5px] font-semibold" style={{ color: agent?.color }}>{agent?.name ?? e.agentId}</span>
                <span className="text-[11px] text-(--text-faint)">{e.verb}</span>
                <time className="ml-auto font-mono text-[10.5px] text-(--text-faint)">{TIME(e.at)}</time>
              </div>
              <p className="mt-0.5 line-clamp-2 text-[12.5px] text-(--foreground)">{e.text}</p>
            </li>
          );
        })}
      </ol>
    </aside>
  );
}

function Heading({ label, meta }: { label: string; meta: string }) {
  return (
    <div className="flex items-baseline justify-between px-4 pb-2 pt-3.5">
      <h3 className="font-display text-[14px] font-semibold tracking-tight text-(--foreground)">{label}</h3>
      <span className="font-mono text-[11px] tabular-nums text-(--text-faint)">{meta}</span>
    </div>
  );
}
