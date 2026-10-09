"use client";

import { useState } from "react";
import { AlertTriangle, Crosshair } from "lucide-react";
import { cn } from "@/lib/utils";
import type { OrreryApproval, OrreryRun } from "@/lib/orrery/types";

export interface CardAgent { id: string; name: string; color: string }

const TIME = (iso: string) => new Date(iso).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/**
 * What needs attention right now: live agent runs and approvals awaiting a
 * decision. Both lists are real rows; the cards disappear when the work does.
 */
export function AttentionCards({ runs, approvals, agents, followId, onFollow, onDecided }: {
  runs: OrreryRun[];
  approvals: OrreryApproval[];
  agents: CardAgent[];
  followId: string | null;
  onFollow: (agentId: string | null) => void;
  /** Called after an approval decision is saved. */
  onDecided: () => void;
}) {
  const [pending, setPending] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const agentOf = (id: string | null) => agents.find((a) => a.id === id);

  const decide = async (id: string, status: "approved" | "rejected") => {
    setPending(id);
    setErrors(({ [id]: _drop, ...rest }) => rest);
    try {
      const res = await fetch(`/api/approvals/${encodeURIComponent(id)}`, {
        method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }),
      });
      if (!res.ok) {
        const body = (await res.json().catch(() => null)) as { error?: string } | null;
        throw new Error(body?.error ?? `Request failed (${res.status})`);
      }
      onDecided();
    } catch (e) {
      setErrors((prev) => ({ ...prev, [id]: e instanceof Error ? e.message : "Decision failed" }));
    } finally {
      setPending(null);
    }
  };

  if (runs.length === 0 && approvals.length === 0) return null;

  return (
    <div className="max-h-[42%] shrink-0 space-y-2 overflow-y-auto border-t border-[--glass-border] px-3 py-2.5" aria-label="Runs and approvals">
      {/* Approvals first: they are what is waiting on a person, and they must not scroll out of reach behind the runs. */}
      {approvals.map((a) => {
        const requester = agentOf(a.requesterAgentId);
        return (
          <article key={a.id} className="rounded-lg border border-[--status-busy]/30 bg-[--status-busy]/[0.06] p-3">
            <header className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider text-[--status-busy]">
              <AlertTriangle className="h-3 w-3" />Approval needed
              <span className="ml-auto text-[--muted-foreground]">{a.risk} risk</span>
            </header>
            <p className="mt-1.5 text-[13px] font-medium leading-snug">{a.title}</p>
            <p className="mt-0.5 font-mono text-[11px] text-[--muted-foreground]">
              {a.type}{requester ? ` · requested by ${requester.name}` : ""}
            </p>
            {a.description ? <p className="mt-1 line-clamp-2 text-[12px] text-[--muted-foreground]">{a.description}</p> : null}
            <div className="mt-2.5 flex gap-2">
              <button
                type="button" disabled={pending === a.id} onClick={() => void decide(a.id, "approved")}
                className="rounded-md bg-[--primary] px-3 py-1 text-[12px] font-medium text-[--primary-foreground] transition-opacity hover:opacity-90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] disabled:opacity-50"
              >
                Approve
              </button>
              <button
                type="button" disabled={pending === a.id} onClick={() => void decide(a.id, "rejected")}
                className="rounded-md border border-[--glass-border] px-3 py-1 text-[12px] text-[--muted-foreground] transition-colors hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring] disabled:opacity-50"
              >
                Reject
              </button>
            </div>
            {errors[a.id] ? <p role="alert" className="mt-2 text-[12px] text-[--destructive]">{errors[a.id]}</p> : null}
          </article>
        );
      })}
      {runs.map((run) => {
        const agent = agentOf(run.agentId);
        const watching = followId === run.agentId;
        return (
          <article key={`${run.kind}:${run.id}`} className={cn("rounded-lg border bg-[--panel] p-3", watching ? "border-[--primary]/50" : "border-[--glass-border]")}>
            <header className="flex items-center gap-2 font-mono text-[10.5px] uppercase tracking-wider">
              <i className="h-1.5 w-1.5 rounded-full" style={{ background: agent?.color ?? "var(--muted-foreground)" }} />
              <span style={{ color: agent?.color }}>{agent?.name ?? run.agentId}</span>
              <span className="ml-auto text-[--text-faint]">{run.status}</span>
            </header>
            <p className="mt-1.5 text-[13px] font-medium leading-snug">{run.title}</p>
            {run.recent.length ? (
              <ol className="mt-2 space-y-0.5 rounded-md bg-[--background]/60 p-2 font-mono text-[11px]">
                {run.recent.slice().reverse().map((r, i) => (
                  <li key={`${r.at}:${i}`} className="flex gap-2 text-[--muted-foreground]">
                    <time className="shrink-0 text-[--text-faint]">{TIME(r.at)}</time>
                    <span className="shrink-0 uppercase">{r.verb}</span>
                    <span className="truncate text-[--foreground]">{r.text}</span>
                  </li>
                ))}
              </ol>
            ) : null}
            <button
              type="button"
              onClick={() => onFollow(watching ? null : run.agentId)}
              aria-pressed={watching}
              className="mt-2.5 flex items-center gap-1.5 rounded-md border border-[--glass-border] px-2.5 py-1 text-[12px] text-[--muted-foreground] transition-colors hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
            >
              <Crosshair className="h-3 w-3" />{watching ? "Watching" : "Watch on graph"}
            </button>
          </article>
        );
      })}

    </div>
  );
}
