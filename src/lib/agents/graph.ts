import { db } from "@/lib/db";
import { syncToGraph, removeFromGraph } from "@/lib/knowledge/sync";
import type { GraphEdgeSpec } from "@/lib/knowledge/sync";

/**
 * Syncs an Agent row to a real KnowledgeObject node. Call after create/update.
 *
 * AgentConfiguration is deliberately NOT synced as its own node — it's a 1:1
 * relationship with Agent, and a 1:1 edge would just be decoration, not a
 * meaningful graph relationship. Instead its data enriches this node's own
 * metadata (fetched here so every call site gets it consistently, without
 * having to remember to load+pass it themselves). AgentHealthCheck/AgentEvent
 * are deliberately not synced at all — high-frequency, unbounded-cardinality
 * rows are the future real-time event stream (Phase 5 of the graph plan),
 * not static graph substrate; turning every health check into a permanent
 * node would flood the graph.
 */
export async function syncAgentToGraph(agent: {
  id: string;
  name: string;
  role: string;
  description: string;
  status: string;
}): Promise<void> {
  const configuration = await db.agentConfiguration.findUnique({ where: { agentId: agent.id } });
  await syncToGraph({
    sourceType: "agent",
    sourceId: agent.id,
    type: "Agent",
    title: agent.name,
    summary: agent.role,
    scope: "global",
    metadata: {
      role: agent.role,
      status: agent.status,
      ...(configuration
        ? { model: configuration.model, memoryScope: configuration.memoryScope, allowedTools: configuration.allowedTools }
        : {}),
    },
  });
}

/** Removes an Agent's graph node. Call after delete. */
export async function removeAgentFromGraph(agentId: string): Promise<void> {
  await removeFromGraph("agent", agentId);
}

/**
 * Syncs an AgentInstance (a concrete runtime process bound to an agent) as
 * its own node — unlike AgentConfiguration this is a genuine one-to-many
 * relationship worth representing (one agent identity can have zero, one,
 * or multiple bound instances), not just decoration.
 */
export async function syncAgentInstanceToGraph(instance: {
  id: string;
  agentId: string;
  kind: string;
  type: string;
  endpoint: string | null;
}): Promise<void> {
  const edges: GraphEdgeSpec[] = [
    { toSourceType: "agent", toSourceId: instance.agentId, type: "belongs_to" },
  ];
  await syncToGraph({
    sourceType: "agent_instance",
    sourceId: instance.id,
    type: "Module",
    title: `${instance.kind} instance`,
    summary: instance.type,
    scope: "global",
    metadata: { kind: instance.kind, type: instance.type, endpoint: instance.endpoint },
    edges,
  });
}

export async function removeAgentInstanceFromGraph(instanceId: string): Promise<void> {
  await removeFromGraph("agent_instance", instanceId);
}
