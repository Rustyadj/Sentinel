import { z } from "zod";
import { db } from "@/lib/db";
import { ingestOperationalEvent, requireOperationalAccess } from "./operational-ingestion";
import type { OperationalEvent } from "./operational-types";

/** Existing deployment/health/runtime sources first. No service or incident is invented from an agent error. */
export async function backfillOperationalSources(userId: string, workspaceId: string, origin: string, after?: string) {
  await requireOperationalAccess(userId, workspaceId, true);
  const base = new URL(origin);
  if (!["http:", "https:"].includes(base.protocol)) throw new Error("Invalid evidence origin");
  const projects = await db.project.findMany({ where: { workspaceId }, select: { id: true }, take: 200 });
  // Each source has an independent stable cursor. Request pages until all are exhausted.
  const cursor = z.object({ deployment: z.string().max(200).optional(), runtime: z.string().max(200).optional(), health: z.string().max(200).optional(), team: z.string().max(200).optional() }).parse(after ? JSON.parse(after) : {});
  const [deployments, runtimeEvents, healthChecks, teams] = await Promise.all([
    db.deployment.findMany({ where: { repository: { projectId: { in: projects.map(item => item.id) } } }, include: { repository: true }, orderBy: { id: "asc" }, ...(cursor.deployment ? { cursor: { id: cursor.deployment }, skip: 1 } : {}), take: 51 }),
    db.agentRuntimeEvent.findMany({ where: { session: { userId, workspaceId }, type: { in: ["error", "session_started", "session_completed", "tool_completed", "approval_required"] } }, include: { session: { select: { id: true, agentId: true } } }, orderBy: { id: "asc" }, ...(cursor.runtime ? { cursor: { id: cursor.runtime }, skip: 1 } : {}), take: 51 }),
    db.healthCheck.findMany({ where: { deployment: { repository: { projectId: { in: projects.map(item => item.id) } } } }, orderBy: { id: "asc" }, ...(cursor.health ? { cursor: { id: cursor.health }, skip: 1 } : {}), take: 51 }),
    db.team.findMany({ where: { workspaceId }, orderBy: { id: "asc" }, ...(cursor.team ? { cursor: { id: cursor.team }, skip: 1 } : {}), take: 51 }),
  ]);
  const events: OperationalEvent[] = [];
  for (const deployment of deployments.slice(0, 50)) {
    const evidence = [new URL(`/api/graph/operations?workspaceId=${encodeURIComponent(workspaceId)}&source=deployment&recordId=${encodeURIComponent(deployment.id)}`, base).href];
    events.push({ source: "sentinel:deployment", sourceEventId: `${deployment.id}:${deployment.observedAt.toISOString()}`, eventTime: deployment.observedAt.toISOString(), evidence, entities: [{ sourceId: deployment.id, type: "Deployment", title: `${deployment.repository.name} ${deployment.environment}`, summary: `Revision ${deployment.sha}; ${deployment.status}; observed via ${deployment.source}`, facts: { status: deployment.status === "failed" ? "failed" : deployment.status === "deployed" ? "healthy" : "unknown" } }, { sourceId: `repository:${deployment.repositoryId}`, type: "Repository", title: deployment.repository.name, facts: {} }], relationships: [{ from: deployment.id, to: `repository:${deployment.repositoryId}`, type: "references", confidence: 1, evidence, validFrom: deployment.observedAt.toISOString() }] });
  }
  for (const health of healthChecks.slice(0, 50)) {
    const target = new URL(health.target, base);
    if (["http:", "https:"].includes(target.protocol)) events.push({ source: "sentinel:health", sourceEventId: health.id, eventTime: health.checkedAt.toISOString(), evidence: [target.href], entities: [{ sourceId: health.target, type: "Service", title: health.target, summary: `Endpoint probe via ${health.source}; describes this endpoint only`, facts: { status: health.status === "ok" ? "healthy" : ["down", "unreachable"].includes(health.status) ? "failed" : "unknown" } }], relationships: [] });
  }
  for (const event of runtimeEvents.slice(0, 50)) {
    const evidence = [new URL(`/api/agent-sessions/${encodeURIComponent(event.session.id)}/events`, base).href];
    const from = `event:${event.id}`, to = `agent:${event.session.agentId}`;
    events.push({ source: "sentinel:runtime", sourceEventId: event.id, eventTime: event.occurredAt.toISOString(), evidence, entities: [{ sourceId: from, type: event.type === "error" ? "Failure" : "Action", title: `${event.session.agentId}: ${event.type}`, facts: { outcome: event.type === "error" ? "unsuccessful" : "unknown" } }, { sourceId: to, type: "Agent", title: event.session.agentId, facts: {} }], relationships: [{ from, to, type: "references", confidence: 1, evidence, validFrom: event.occurredAt.toISOString() }] });
  }
  for (const team of teams.slice(0, 50)) {
    const evidence = [new URL(`/api/teams/${encodeURIComponent(team.id)}`, base).href];
    events.push({ source: "sentinel:team", sourceEventId: `${team.id}:${team.updatedAt.toISOString()}`, eventTime: team.updatedAt.toISOString(), evidence, entities: [{ sourceId: team.id, type: "Team", title: team.name, summary: team.description ?? undefined, facts: {} }], relationships: [] });
  }
  const results = [];
  for (const event of events) results.push(await ingestOperationalEvent(userId, workspaceId, event));
  return { scanned: deployments.slice(0, 50).length + runtimeEvents.slice(0, 50).length + healthChecks.slice(0, 50).length + teams.slice(0, 50).length, ingested: results.filter(result => !result.duplicate).length, partial: projects.length === 200 || deployments.length > 50 || runtimeEvents.length > 50 || healthChecks.length > 50 || teams.length > 50, nextCursor: JSON.stringify({ deployment: deployments.slice(0, 50).at(-1)?.id ?? cursor.deployment, runtime: runtimeEvents.slice(0, 50).at(-1)?.id ?? cursor.runtime, health: healthChecks.slice(0, 50).at(-1)?.id ?? cursor.health, team: teams.slice(0, 50).at(-1)?.id ?? cursor.team }), limitations: ["Existing source adapters run on explicit refresh/backfill. Endpoint health is not an inferred service dependency or incident.", "Unattributed repositories and health checks without a workspace-linked deployment are excluded; monitoring integrations can supply incident history through the same ingestion envelope."] };
}
