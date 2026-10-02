"use client";

import { cn } from "@/lib/utils";

export interface PanelAgent {
  id: string;
  name: string;
  color: string;
  model: string;
  state: "working" | "idle" | "offline";
  detail: string;
}

export interface FeedEvent {
  id: string;
  agentName: string;
  color: string;
  verb: string;
  text: string;
  time: string;
}

const STATE_LABEL: Record<PanelAgent["state"], string> = { working: "WORKING", idle: "IDLE", offline: "OFFLINE" };

/** Live agents and a feed of what they have just done, over the globe. */
export function ActivityPanel({ agents, events, followId, onFollow }: {
  agents: PanelAgent[];
  events: FeedEvent[];
  followId: string | null;
  onFollow: (agentId: string | null) => void;
}) {
  const live = agents.filter((a) => a.state === "working").length;
  return (
    <aside data-orrery-ui aria-label="Agent activity" className="absolute bottom-3.5 right-3.5 top-3.5 z-[3] hidden w-[300px] flex-col overflow-hidden rounded-xl border border-[--glass-border] bg-[--glass] backdrop-blur-md xl:flex">
      <Heading label="Agents" meta={`${live} live`} />
      <ul className="max-h-[46%] shrink-0 space-y-1 overflow-y-auto px-2 pb-2">
        {agents.length === 0 ? <li className="px-2 py-3 text-[12px] text-[--muted-foreground]">No agents registered.</li> : null}
        {agents.map((a) => {
          const active = a.id === followId;
          return (
            <li key={a.id}>
              <button
                type="button"
                onClick={() => onFollow(active ? null : a.id)}
                aria-pressed={active}
                className={cn(
                  "w-full rounded-lg border px-3 py-2 text-left transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]",
                  active ? "border-[--primary]/40 bg-[--accent]" : "border-transparent hover:bg-[--muted]",
                )}
              >
                <div className="flex items-center gap-2">
                  <i className="h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: a.color }} />
                  <span className="truncate text-[13px] font-semibold">{a.name}</span>
                  <span className={cn("ml-auto font-mono text-[10px] tracking-wider", a.state === "working" ? "text-[--status-busy]" : "text-[--text-faint]")}>{STATE_LABEL[a.state]}</span>
                </div>
                <p className="mt-1 truncate text-[12px] text-[--muted-foreground]">{a.detail}</p>
                <p className="mt-0.5 truncate font-mono text-[10.5px] text-[--text-faint]">{a.model}</p>
              </button>
            </li>
          );
        })}
      </ul>
      <div className="mx-3 h-px bg-[--glass-border]" />
      <Heading label="Event feed" meta={String(events.length)} />
      <ol className="min-h-0 flex-1 space-y-px overflow-y-auto px-2 pb-3">
        {events.length === 0 ? <li className="px-2 py-3 text-[12px] text-[--muted-foreground]">Events appear as agents work.</li> : null}
        {events.map((e) => (
          <li key={e.id} className="rounded-lg px-3 py-2">
            <div className="flex items-baseline gap-2">
              <span className="truncate text-[12.5px] font-semibold" style={{ color: e.color }}>{e.agentName}</span>
              <span className="font-mono text-[10px] uppercase tracking-wider text-[--text-faint]">{e.verb}</span>
              <time className="ml-auto font-mono text-[10.5px] text-[--text-faint]">{e.time}</time>
            </div>
            <p className="mt-0.5 line-clamp-2 text-[12.5px] text-[--foreground]">{e.text}</p>
          </li>
        ))}
      </ol>
    </aside>
  );
}

function Heading({ label, meta }: { label: string; meta: string }) {
  return (
    <div className="flex items-center justify-between px-4 pb-2 pt-3.5 font-mono text-[10.5px] uppercase tracking-[0.14em] text-[--muted-foreground]">
      <span>{label}</span>
      <span>{meta}</span>
    </div>
  );
}
