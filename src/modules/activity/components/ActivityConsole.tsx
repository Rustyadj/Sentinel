"use client";

import { formatDistanceToNow } from "date-fns";
import { Bot, GitBranch } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { WorkspaceHeader } from "@/components/workspace/WorkspaceHeader";
import { WorkspaceShell } from "@/components/workspace/WorkspaceShell";
import type { ActivityItem } from "@/lib/activity/feed";

export function ActivityConsole({ items }: { items: ActivityItem[] }) {
  return (
    <WorkspaceShell>
      <WorkspaceHeader
        title="Activity"
        description="What agents and collaboration rooms have done, most recent first."
        showBack={false}
      />

      <ol className="divide-y divide-[--canvas-card-border] rounded-lg border border-[--canvas-card-border]">
        {items.map((item) => (
          <li key={item.id} className="flex items-start gap-3 px-4 py-3">
            <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-md bg-[--muted] text-[--muted-foreground]">
              {item.source === "runtime" ? <Bot className="h-3.5 w-3.5" /> : <GitBranch className="h-3.5 w-3.5" />}
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[13px] text-[--canvas-foreground]">{item.summary}</p>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-[--muted-foreground]">
                <Badge variant="outline" className="font-mono">
                  {item.type}
                </Badge>
                {item.chatRoomName ? <span>{item.chatRoomName}</span> : null}
                <time dateTime={item.occurredAt.toString()} suppressHydrationWarning>
                  {formatDistanceToNow(item.occurredAt, { addSuffix: true })}
                </time>
              </div>
            </div>
          </li>
        ))}
        {items.length === 0 ? (
          <li className="px-4 py-10 text-center text-[--muted-foreground]">
            No activity yet — agent sessions and collaboration rooms will show up here as they run.
          </li>
        ) : null}
      </ol>
    </WorkspaceShell>
  );
}
