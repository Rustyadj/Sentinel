"use client";

import { useCallback, useMemo, useRef } from "react";
import type { PanelAgent } from "@/components/orrery/ActivityPanel";
import { useOrreryData } from "@/components/orrery/useOrreryData";
import { CANONICAL_VOICE_AGENT_IDS } from "@/lib/voice/agent-voice-config";
import type { OrreryEvent } from "@/lib/orrery/types";
import type { Agent } from "@/types";
import type { StageAgent, WatchHandle } from "./WatchStage";

/**
 * What an event says an agent is doing, short enough to sit beside its light.
 * A command, file or path reads better with its verb ("Running npm test");
 * an objective is already a sentence and is left as it was written.
 */
export function describeEvent(event: OrreryEvent): string {
  switch (event.verb) {
    case "exec": return `Running ${event.text}`;
    case "write": return `Writing ${event.text}`;
    case "read": return `Reading ${event.text}`;
    case "done": return `Finished: ${event.text}`;
    case "fail": return `Failed: ${event.text}`;
    default: return event.text;
  }
}

/**
 * Everything the watch shows, derived from real activity: which agents are
 * working, what each is doing, and the events that cast beams. `local` lets a
 * surface add what only it knows, such as the agent now writing a chat reply.
 */
export function useWatch(agents: Agent[], local?: { workingAgentId: string | null; detail: string }) {
  const handleRef = useRef<WatchHandle>(null);
  const onEvents = useCallback((events: OrreryEvent[]) => {
    for (const event of events) handleRef.current?.dispatch(event.agentId, event.nodeIds);
  }, []);
  const orrery = useOrreryData(onEvents);

  const activityState = useMemo(() => new Map((orrery.activity?.agents ?? []).map((x) => [x.agentId, x])), [orrery.activity]);
  const latestByAgent = useMemo(() => {
    const map = new Map<string, OrreryEvent>();
    for (const event of orrery.feed) if (!map.has(event.agentId)) map.set(event.agentId, event);
    return map;
  }, [orrery.feed]);

  const localId = local?.workingAgentId ?? null;
  const localDetail = local?.detail ?? "";
  // Working = a live session or run on the server, or this surface is waiting on that agent.
  const isWorking = useCallback(
    (agentId: string) => agentId === localId || activityState.get(agentId)?.state === "working",
    [localId, activityState],
  );

  const captionOf = useCallback((agentId: string) => {
    if (agentId === localId && localDetail) return localDetail;
    const latest = latestByAgent.get(agentId);
    return latest ? describeEvent(latest) : "Working";
  }, [localId, localDetail, latestByAgent]);

  const stageAgents: StageAgent[] = useMemo(() => agents.map((a) => {
    const working = isWorking(a.id);
    return { id: a.id, name: a.name, color: a.color, working, nodeId: activityState.get(a.id)?.nodeId ?? null, caption: working ? captionOf(a.id) : undefined };
  }), [agents, isWorking, activityState, captionOf]);

  const panelAgents: PanelAgent[] = useMemo(() => agents.map((a) => {
    const working = isWorking(a.id);
    return {
      id: a.id, name: a.name, color: a.color, model: a.model,
      state: working ? "working" : a.status === "offline" ? "offline" : "idle",
      detail: working ? captionOf(a.id) : a.role,
      voice: (CANONICAL_VOICE_AGENT_IDS as readonly string[]).includes(a.id),
    };
  }), [agents, isWorking, captionOf]);

  const graphMessage = orrery.status === "error"
    ? orrery.error
    : orrery.status === "ready" && (orrery.model?.nodeCount ?? 0) === 0
      ? "The graph is empty. Projects, tasks and memories take their place on the rings as Sentinel records them."
      : null;

  return { orrery, handleRef, activityState, stageAgents, panelAgents, graphMessage };
}
