"use client";

import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { workspaceApi } from "../api";
import { EmptyNote, ErrorNote, relativeTime, useResource } from "./primitives";

const SEVERITY_COLOR: Record<string, string> = {
  info: "text-[--muted-foreground]",
  warn: "text-amber-400",
  error: "text-[--destructive]",
};

export function ActivityTab({ workspaceId }: { workspaceId: string }) {
  const events = useResource(() => workspaceApi.events(workspaceId, 200), workspaceId);
  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between text-xs text-[--muted-foreground]">
        <span>Append-only audit trail. Every entry is also written to Sentinel&apos;s global audit log.</span>
        <Button size="sm" variant="ghost" onClick={() => void events.refresh()}><RefreshCw className="h-3.5 w-3.5" /></Button>
      </div>
      <ErrorNote error={events.error} />
      <div className="rounded-md border border-[--border]">
        {events.data?.events.length ? events.data.events.map((event) => (
          <div key={event.id} className="flex flex-wrap items-baseline gap-3 border-b border-[--border] px-3 py-2 text-xs last:border-b-0">
            <span className="w-44 shrink-0 font-mono text-[11px]">{event.type}</span>
            <span className={`min-w-0 flex-1 ${SEVERITY_COLOR[event.severity] ?? ""}`}>{event.message}</span>
            <span className="text-[11px] text-[--muted-foreground]">
              {event.source}
              {event.actorAgentId ? ` · agent ${event.actorAgentId}` : ""}
              {event.actorUserId ? ` · user ${event.actorUserId}` : ""}
            </span>
            <span className="w-24 shrink-0 text-right text-[11px] text-[--muted-foreground]">{relativeTime(event.occurredAt)}</span>
          </div>
        )) : <EmptyNote>No activity recorded yet.</EmptyNote>}
      </div>
    </div>
  );
}
