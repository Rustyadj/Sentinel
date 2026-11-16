"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { AppShell } from "@/components/shell/AppShell";
import { ActivityPanel } from "@/components/orrery/ActivityPanel";
import { OrreryStatusStrip, orreryNotices } from "@/components/orrery/OrreryStatusStrip";
import { WatchStage } from "@/components/watch/WatchStage";
import { useWatch } from "@/components/watch/useWatch";
import { useAgentStore } from "@/store/useAgentStore";
import { cn } from "@/lib/utils";

/**
 * The live graph on its own: every agent's light, what each is doing, and
 * the beam it casts on what it is touching, with the full event feed beside it.
 */
export function WatchSurface() {
  const agents = useAgentStore((state) => state.agents);
  const [followId, setFollowId] = useState<string | null>(null);
  const { orrery, handleRef, stageAgents, panelAgents, graphMessage } = useWatch(agents);

  const notices = useMemo(
    () => orreryNotices({ ready: orrery.status === "ready", graph: orrery.graphHealth, activity: orrery.activityHealth, partial: orrery.partial, activityTruncated: orrery.activityTruncated }),
    [orrery.status, orrery.graphHealth, orrery.activityHealth, orrery.partial, orrery.activityTruncated],
  );
  const working = stageAgents.filter((agent) => agent.working);
  // While following one agent, the feed is that agent's.
  const events = followId ? orrery.feed.filter((event) => event.agentId === followId) : orrery.feed;

  const header = (
    <div className="flex min-w-0 items-center gap-3">
      <p className="hidden truncate text-[13px] text-(--muted-foreground) sm:block" aria-live="polite">
        {working.length === 0 ? "No agent is working right now" : `${working.map((a) => a.name).join(", ")} ${working.length === 1 ? "is" : "are"} working`}
      </p>
      <Link href="/neural-lens" className="shrink-0 text-[13px] text-(--muted-foreground) underline-offset-2 hover:text-(--foreground) hover:underline">Explore the full graph</Link>
    </div>
  );

  return (
    <AppShell title="Live graph" header={header}>
      <div className="watch-ground flex h-full flex-col xl:flex-row">
        <div className="relative min-h-0 min-w-0 flex-1">
          <WatchStage
            model={orrery.model}
            message={graphMessage}
            handleRef={handleRef}
            agents={stageAgents}
            focusIds={[]}
            followId={followId}
            onFollowChange={setFollowId}
          >
            <OrreryStatusStrip notices={notices} onRetry={orrery.retry} />
          </WatchStage>
        </div>
        <ActivityPanel agents={panelAgents} events={events} followId={followId} onFollow={setFollowId} onTranscript={() => undefined} />
        {/* Below xl the column has no room; the agents still say what they are doing, in a strip. */}
        <ul aria-label="Agents" className="flex shrink-0 gap-2 overflow-x-auto border-t border-(--border) bg-(--panel) px-3 py-2.5 xl:hidden">
          {panelAgents.map((agent) => (
            <li key={agent.id} className="shrink-0">
              <button
                type="button"
                aria-pressed={followId === agent.id}
                onClick={() => setFollowId(followId === agent.id ? null : agent.id)}
                className={cn("flex max-w-[240px] items-center gap-2 rounded-full border px-3 py-1.5 text-left text-[12.5px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-(--ring)",
                  followId === agent.id ? "border-(--primary) bg-(--primary-wash)" : "border-(--border)")}
              >
                <i aria-hidden className={cn("h-2.5 w-2.5 shrink-0 rounded-full", agent.state !== "working" && "opacity-50")} style={{ background: agent.color }} />
                <span className="font-semibold">{agent.name}</span>
                <span className="truncate text-(--muted-foreground)">{agent.state === "working" ? agent.detail : "Idle"}</span>
              </button>
            </li>
          ))}
        </ul>
      </div>
    </AppShell>
  );
}
