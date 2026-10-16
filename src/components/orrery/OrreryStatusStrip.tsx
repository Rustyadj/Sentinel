"use client";

import { AlertTriangle, RefreshCw } from "lucide-react";
import type { SourceHealth } from "./useOrreryData";

const clock = (at: number) => new Date(at).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });

/** The notices the Orrery owes its viewer: what is failing, how old the data on screen is, and what was left out. */
export function orreryNotices(input: {
  ready: boolean;
  graph: SourceHealth;
  activity: SourceHealth;
  partial: boolean;
  activityTruncated: boolean;
}): Array<{ id: string; tone: "error" | "info"; text: string }> {
  const notices: Array<{ id: string; tone: "error" | "info"; text: string }> = [];
  const since = (health: SourceHealth) => (health.lastOkAt ? `Showing data from ${clock(health.lastOkAt)}.` : "Nothing has loaded yet.");
  // Before the first successful graph read the globe's own empty message carries the error.
  if (input.ready && input.graph.error) notices.push({ id: "graph", tone: "error", text: `Graph is not updating: ${input.graph.error} ${since(input.graph)}` });
  if (input.activity.error) notices.push({ id: "activity", tone: "error", text: `Agent activity is not updating: ${input.activity.error} ${since(input.activity)}` });
  if (input.activityTruncated && !input.activity.error) notices.push({ id: "truncated", tone: "info", text: "Agents are very busy. Catching up on activity in batches." });
  if (input.partial && input.ready && !input.graph.error) notices.push({ id: "partial", tone: "info", text: "Showing the newest part of a larger graph." });
  return notices;
}

export function OrreryStatusStrip({ notices, onRetry }: { notices: ReturnType<typeof orreryNotices>; onRetry: () => void }) {
  if (!notices.length) return null;
  const hasError = notices.some((n) => n.tone === "error");
  return (
    <div data-orrery-ui role="status" aria-live="polite" className="pointer-events-none absolute left-3.5 right-3.5 top-3.5 z-[4] flex flex-col items-center gap-1.5 lg:left-[calc(min(468px,40%)+1.75rem)] xl:right-[calc(300px+1.75rem)]">
      {notices.map((notice) => (
        <div
          key={notice.id}
          data-testid={`orrery-notice-${notice.id}`}
          className="pointer-events-auto flex max-w-[34rem] items-start gap-2 rounded-lg border border-[--glass-border] bg-[--glass] px-3 py-1.5 text-[12px] text-[--foreground] backdrop-blur"
        >
          {notice.tone === "error" ? <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-[--status-busy]" aria-hidden /> : null}
          <span>{notice.text}</span>
        </div>
      ))}
      {hasError ? (
        <button
          type="button"
          onClick={onRetry}
          className="pointer-events-auto flex items-center gap-1.5 rounded-lg border border-[--glass-border] bg-[--glass] px-2.5 py-1 text-[12px] text-[--muted-foreground] backdrop-blur hover:text-[--foreground] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[--ring]"
        >
          <RefreshCw className="h-3 w-3" aria-hidden /> Retry now
        </button>
      ) : null}
    </div>
  );
}
