import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { readableWorkspaceIds, resolveMemoryScopeAccess } from "./memory-scope";
import { buildRetrievalFilters } from "./retrieval";
import { operationalMetadata, OPERATIONAL_TYPES, type OperationalLens } from "./operational-types";
import { operationalId, operationalTransaction, requireOperationalAccess } from "./operational-ingestion";
import { discoverCorrelations, predictBlastRadius, type FailureObservation } from "./operational-analysis";

/** Also used by general graph surfaces: memory governance follows operational incidents into the graph. */
export async function operationalVisibility(userId: string) {
  const workspaceIds = await readableWorkspaceIds(userId);
  const filter = buildRetrievalFilters({ userId }, { workspaceIds, deniedRequestedWorkspace: false }).memory;
  const memories = await db.memory.findMany({ where: { AND: [filter, { tags: { has: "operational" } }] }, select: { id: true }, take: 2000 });
  return { workspaceIds, memoryIds: new Set(memories.map(item => item.id)) };
}
export async function operationalSnapshot(userId: string, workspaceId: string) {
  await requireOperationalAccess(userId, workspaceId);
  const access = await resolveMemoryScopeAccess(userId, workspaceId);
  const records = await db.knowledgeObject.findMany({ where: { workspaceId, OR: [{ sourceType: { startsWith: "operational:" } }, { metadata: { path: ["operational"], equals: true } }], type: { in: [...OPERATIONAL_TYPES] }, validTo: null }, orderBy: { updatedAt: "desc" }, take: 601 });
  const memoryIds = records.flatMap(node => operationalMetadata(node.metadata)?.memoryId ?? []);
  const memories = await db.memory.findMany({ where: { AND: [buildRetrievalFilters({ userId, workspaceId }, access).memory, { id: { in: memoryIds } }] }, select: { id: true }, take: 600 });
  const admitted = new Set(memories.map(item => item.id));
  const nodes = records.slice(0, 600).filter(node => node.type !== "Incident" || admitted.has(operationalMetadata(node.metadata)?.memoryId ?? ""));
  const ids = nodes.map(node => node.id);
  const edges = ids.length ? await db.knowledgeEdge.findMany({ where: { fromObjectId: { in: ids }, toObjectId: { in: ids }, OR: [{ validTo: null }, { validTo: { gt: new Date() } }, { type: { in: ["SERVICE_AFFECTED_BY_INCIDENT", "INCIDENT_TRIGGERED_ALERT", "RESPONDER_HANDLED_INCIDENT", "ACTION_RESOLVED_INCIDENT", "references"] } }], validFrom: { lte: new Date() } }, take: 2401 }) : [];
  const visibleIds = new Set(nodes.map(node => node.id));
  const governedEdges = edges.slice(0, 2400).filter(edge => { const incidentIds = (edge.metadata as { incidentIds?: string[] }).incidentIds; return !incidentIds || incidentIds.every(id => visibleIds.has(id)); });
  return { nodes, edges: governedEdges, partial: records.length > 600 || edges.length > 2400 };
}
function failureObservations(snapshot: Awaited<ReturnType<typeof operationalSnapshot>>): FailureObservation[] {
  const incidents = new Map(snapshot.nodes.filter(node => node.type === "Incident").map(node => [node.id, operationalMetadata(node.metadata)!]));
  return snapshot.edges.flatMap(edge => {
    const incident = incidents.get(edge.toObjectId);
    return edge.type === "SERVICE_AFFECTED_BY_INCIDENT" && incident ? [{ incidentId: edge.toObjectId, serviceId: edge.fromObjectId, at: Date.parse(incident.facts.startedAt ?? incident.eventTime), evidence: incident.evidence }] : [];
  });
}
export async function proposeDependencies(userId: string, workspaceId: string) {
  await requireOperationalAccess(userId, workspaceId, true);
  const snapshot = await operationalSnapshot(userId, workspaceId);
  const observations = failureObservations(snapshot);
  const coveragePartial = snapshot.partial || observations.length > 1000 || new Set(observations.map(item => item.serviceId)).size > 100;
  const proposals = discoverCorrelations(observations).map(proposal => ({ ...proposal, validation: { ...proposal.validation, reliable: proposal.validation.reliable && !coveragePartial } }));
  await operationalTransaction(async tx => {
    for (const proposal of proposals) {
      const key = { fromObjectId: proposal.from, toObjectId: proposal.to, type: "SERVICE_CORRELATED_WITH_SERVICE" };
      const existing = await tx.knowledgeEdge.findUnique({ where: { fromObjectId_toObjectId_type: key } });
      if (existing) continue; // Reviewed decisions remain authoritative; refresh requires a new explicit review.
      const id = operationalId(workspaceId, "correlation", proposal.from, proposal.to);
      const at = new Date();
      await tx.knowledgeEdge.create({ data: { id, ...key, weight: proposal.confidence, validFrom: at, changedBy: userId, sourceEventId: id, metadata: { operational: true, status: "proposed", source: "incident-history", eventTime: at.toISOString(), ...proposal } as unknown as Prisma.InputJsonValue } });
      await tx.knowledgeEvent.create({ data: { id, type: "operational.correlation.proposed", workspaceId, userId, payload: { edgeId: id, proposal } as unknown as Prisma.InputJsonValue } });
    }
  });
  return { proposals, partial: coveragePartial };
}
export async function reviewDependency(userId: string, workspaceId: string, edgeId: string, verdict: "confirmed" | "rejected") {
  await requireOperationalAccess(userId, workspaceId, true);
  const snapshot = await operationalSnapshot(userId, workspaceId);
  if (!snapshot.edges.some(edge => edge.id === edgeId)) throw new Error("Relationship not found");
  return operationalTransaction(async tx => {
    const edge = await tx.knowledgeEdge.findFirst({ where: { id: edgeId, type: "SERVICE_CORRELATED_WITH_SERVICE", fromObject: { workspaceId }, toObject: { workspaceId } } });
    if (!edge) throw new Error("Relationship not found");
    const metadata = edge.metadata as Record<string, Prisma.JsonValue>;
    if (metadata.status !== "proposed") throw new Error("Relationship already reviewed");
    const at = new Date();
    const reviewed = { ...metadata, status: verdict, reviewedBy: userId, reviewedAt: at.toISOString() };
    await tx.knowledgeEdge.update({ where: { id: edge.id }, data: { metadata: reviewed, changedBy: userId, version: { increment: 1 }, ...(verdict === "rejected" ? { validTo: at } : {}) } });
    // Confirming a correlation confirms the observed association. A dependency needs a separate explicit assertion via ingestion.
    await tx.knowledgeEvent.create({ data: { type: "operational.correlation.reviewed", workspaceId, userId, payload: { edgeId, before: metadata, after: reviewed } } });
    return { edgeId, status: verdict };
  });
}
export async function operationalGraph(userId: string, workspaceId: string, lens: OperationalLens, failedServiceId?: string) {
  const snapshot = await operationalSnapshot(userId, workspaceId);
  const observations = failureObservations(snapshot);
  const rejectedEdges = await db.knowledgeEdge.findMany({ where: { type: "SERVICE_CORRELATED_WITH_SERVICE", fromObject: { workspaceId }, toObject: { workspaceId }, metadata: { path: ["status"], equals: "rejected" } }, take: 1000 });
  const rejected = new Set(rejectedEdges.map(edge => `${edge.fromObjectId}:${edge.toObjectId}`));
  const coveragePartial = snapshot.partial || observations.length > 1000 || new Set(observations.map(item => item.serviceId)).size > 100;
  const correlations = discoverCorrelations(observations).filter(item => !rejected.has(`${item.from}:${item.to}`)).map(item => ({ ...item, validation: { ...item.validation, reliable: item.validation.reliable && !coveragePartial } }));
  const services = snapshot.nodes.filter(node => node.type === "Service");
  if (failedServiceId && !services.some(node => node.id === failedServiceId)) throw new Error("Service not found");
  const impacts = failedServiceId ? predictBlastRadius(failedServiceId, services.map(node => node.id), snapshot.edges.filter(edge => edge.type === "depends_on").map(edge => ({ from: edge.fromObjectId, to: edge.toObjectId, evidence: (edge.metadata as { evidence?: string[] }).evidence ?? [] })), correlations, new Map(services.map(node => { const meta = operationalMetadata(node.metadata)!; return [node.id, { status: meta.facts.status ?? "unknown", at: Date.parse(meta.eventTime), evidence: meta.evidence }]; }))) : [];
  const lensTypes: Record<OperationalLens, string[]> = { incident: ["Service", "Incident", "Agent", "Person", "Action", "Resolution", "Alert"], dependency: ["Service", "InfrastructureResource", "Deployment"], "blast-radius": ["Service", "Incident"], team: ["Team", "Service", "Incident", "Agent", "Person"], alert: ["Alert", "Incident", "Service"], onboarding: [...OPERATIONAL_TYPES] };
  const visible = snapshot.nodes.filter(node => lensTypes[lens].includes(node.type));
  const visibleIds = new Set(visible.map(node => node.id));
  const capacityEvents = lens === "team" ? await db.knowledgeEvent.findMany({ where: { workspaceId, type: "operational.ingested" }, orderBy: { createdAt: "desc" }, take: 501 }) : [];
  const capacityPayloads = capacityEvents.slice(0, 500).map(record => record.payload as unknown as { event: import("./operational-types").OperationalEvent; entityIds: Record<string, string> }).sort((a, b) => Date.parse(a.event.eventTime) - Date.parse(b.event.eventTime));
  const ownershipTimeline = new Map<string, { at: number; from: number; to: number | null }[]>();
  for (const payload of capacityPayloads) for (const relationship of payload.event.relationships) {
    if (relationship.type !== "TEAM_OWNS_SERVICE") continue;
    const key = `${payload.entityIds[relationship.from]}:${payload.entityIds[relationship.to]}`;
    const history = ownershipTimeline.get(key) ?? [];
    history.push({ at: Date.parse(payload.event.eventTime), from: Date.parse(relationship.validFrom), to: relationship.validTo ? Date.parse(relationship.validTo) : null });
    ownershipTimeline.set(key, history);
  }
  const teams = snapshot.nodes.filter(node => node.type === "Team").map(team => {
    const owned = new Set(snapshot.edges.filter(edge => edge.type === "TEAM_OWNS_SERVICE" && edge.fromObjectId === team.id).map(edge => edge.toObjectId));
    const facts = operationalMetadata(team.metadata)!.facts;
    const incidents = new Set(observations.filter(item => owned.has(item.serviceId)).map(item => item.incidentId));
    const capacity = facts.capacityHours;
    const ownedObservations = observations.filter(observation => {
      const history = ownershipTimeline.get(`${team.id}:${observation.serviceId}`) ?? [];
      for (let index = history.length - 1; index >= 0; index--) {
        const assertion = history[index];
        if (assertion.at <= observation.at) return assertion.from <= observation.at && (assertion.to === null || assertion.to > observation.at);
      }
      return false;
    });
    const capacityIntervals = new Map<string, { from: string; to: string; capacityHours: number; incidentCount: number; incidentsPerCapacityHour: number; evidence: string[] }>();
    for (const payload of capacityPayloads) for (const entity of payload.event.entities) {
      if (payload.entityIds[entity.sourceId] !== team.id || !entity.facts.capacityHours || !entity.facts.capacityFrom || !entity.facts.capacityTo) continue;
      const { capacityHours, capacityFrom, capacityTo } = entity.facts;
      const affected = new Set(ownedObservations.filter(observation => observation.at >= Date.parse(capacityFrom) && observation.at < Date.parse(capacityTo)).map(observation => observation.incidentId));
      capacityIntervals.set(`${capacityFrom}:${capacityTo}`, { from: capacityFrom, to: capacityTo, capacityHours, incidentCount: affected.size, incidentsPerCapacityHour: affected.size / capacityHours, evidence: payload.event.evidence });
    }
    const capacityTrend = [...capacityIntervals.values()].sort((a, b) => Date.parse(a.from) - Date.parse(b.from));
    return { id: team.id, title: team.title, incidents: incidents.size, capacityTrend, trendPartial: capacityEvents.length > 500 || coveragePartial, incidentsPerCapacityHour: capacity ? capacityTrend.find(interval => interval.from === facts.capacityFrom && interval.to === facts.capacityTo)?.incidentsPerCapacityHour ?? null : null, capacityFrom: facts.capacityFrom ?? null, capacityTo: facts.capacityTo ?? null, responseActions: snapshot.edges.filter(edge => edge.type === "ACTION_RESOLVED_INCIDENT" && incidents.has(edge.toObjectId)).length };
  });
  const alerts = snapshot.nodes.filter(node => node.type === "Alert");
  const alertAnalytics = { total: alerts.length, actionable: alerts.filter(node => operationalMetadata(node.metadata)?.facts.classification === "actionable").length, falsePositives: alerts.filter(node => operationalMetadata(node.metadata)?.facts.classification === "false_positive").length, duplicates: alerts.filter(node => operationalMetadata(node.metadata)?.facts.classification === "duplicate").length, recommendations: alerts.filter(node => ["false_positive", "duplicate"].includes(operationalMetadata(node.metadata)?.facts.classification ?? "")).map(node => ({ id: node.id, recommendation: "Review routing or grouping; human approval required before changing alert rules", evidence: operationalMetadata(node.metadata)!.evidence })) };
  const impactById = new Map(impacts.map(impact => [impact.serviceId, impact]));
  return { nodes: visible.map(node => ({ ...node, metadata: { ...(node.metadata as object), ...(impactById.has(node.id) ? { impact: impactById.get(node.id) } : {}) }, degree: snapshot.edges.filter(edge => edge.fromObjectId === node.id || edge.toObjectId === node.id).length, truncatedDegree: 0 })), edges: snapshot.edges.filter(edge => visibleIds.has(edge.fromObjectId) && visibleIds.has(edge.toObjectId)), focusId: failedServiceId ?? null, partial: coveragePartial, totalVisible: visible.length, impacts, teams, alertAnalytics, correlations, notices: [coveragePartial ? "Analysis covers a bounded sample; backfill or narrow the source window before treating it as complete" : null, lens === "blast-radius" && !failedServiceId ? "Select a service to inspect its blast radius" : null].filter(Boolean) };
}

export async function filterOperationalNodes<T extends { type: string; workspaceId?: string | null; metadata: unknown }>(userId: string, records: T[]): Promise<T[]> {
  if (!records.some(record => operationalMetadata(record.metadata))) return records;
  const access = await operationalVisibility(userId);
  return records.filter(record => {
    const meta = operationalMetadata(record.metadata);
    return !meta || (!!record.workspaceId && access.workspaceIds.includes(record.workspaceId) && (record.type !== "Incident" || (!!meta.memoryId && access.memoryIds.has(meta.memoryId))));
  });
}

/** Immutable operational relationship observations, kept alongside the current graph projection. */
export async function operationalHistory(userId: string, workspaceId: string, nodeId: string) {
  const snapshot = await operationalSnapshot(userId, workspaceId);
  if (!snapshot.nodes.some(node => node.id === nodeId)) throw new Error("Node not found");
  const events = await db.knowledgeEvent.findMany({ where: { workspaceId, type: "operational.ingested" }, orderBy: { createdAt: "desc" }, take: 501 });
  const permittedMemories = new Set((await db.memory.findMany({ where: { AND: [buildRetrievalFilters({ userId, workspaceId }, await resolveMemoryScopeAccess(userId, workspaceId)).memory, { source: { startsWith: "operational:" } }] }, select: { id: true }, take: 2000 })).map(memory => memory.id));
  const revisions = events.slice(0, 500).flatMap(record => {
    const payload = record.payload as unknown as { event: import("./operational-types").OperationalEvent; entityIds: Record<string, string>; memoryIds: string[] };
    const sourceId = Object.keys(payload.entityIds).find(key => payload.entityIds[key] === nodeId);
    if (!sourceId || payload.memoryIds.some(id => !permittedMemories.has(id))) return [];
    return [{ id: record.id, recordedAt: record.createdAt, eventTime: payload.event.eventTime, source: payload.event.source, sourceEventId: payload.event.sourceEventId, evidence: payload.event.evidence, relationships: payload.event.relationships.filter(edge => edge.from === sourceId || edge.to === sourceId) }];
  }).sort((a, b) => Date.parse(b.eventTime) - Date.parse(a.eventTime));
  return { revisions, partial: snapshot.partial || events.length > 500 || permittedMemories.size === 2000 };
}

export async function filterOperationalEdges<T extends { metadata: unknown }>(userId: string, edges: T[]): Promise<T[]> {
  const evidenceIds = [...new Set(edges.flatMap(edge => (edge.metadata as { incidentIds?: string[] } | null)?.incidentIds ?? []))];
  if (!evidenceIds.length) return edges;
  const records = await db.knowledgeObject.findMany({ where: { id: { in: evidenceIds.slice(0, 2000) } }, take: 2000 });
  const visible = new Set((await filterOperationalNodes(userId, records)).map(node => node.id));
  return edges.filter(edge => { const ids = (edge.metadata as { incidentIds?: string[] } | null)?.incidentIds; return !ids || ids.every(id => visible.has(id)); });
}

/** Event-time reconstruction from the canonical graph's immutable observations, never from today's mutable metadata. */
export async function operationalGraphAsOf(userId: string, at: Date, workspaceId?: string) {
  const visibility = await operationalVisibility(userId);
  if (workspaceId && !visibility.workspaceIds.includes(workspaceId)) throw new Error("Workspace not found");
  const workspaces = workspaceId ? [workspaceId] : visibility.workspaceIds;
  const events = await db.knowledgeEvent.findMany({ where: { workspaceId: { in: workspaces }, type: "operational.ingested" }, orderBy: { createdAt: "desc" }, take: 501 });
  const current = await db.knowledgeObject.findMany({ where: { workspaceId: { in: workspaces }, OR: [{ sourceType: { startsWith: "operational:" } }, { metadata: { path: ["operational"], equals: true } }] }, take: 1200 });
  const permitted = new Map((await filterOperationalNodes(userId, current)).map(node => [node.id, node]));
  const nodes = new Map<string, typeof current[number]>();
  const edges = new Map<string, { id: string; fromObjectId: string; toObjectId: string; type: string; weight: number; metadata: Record<string, unknown> }>();
  const ordered = events.slice(0, 500).map(record => ({ record, payload: record.payload as unknown as { event: import("./operational-types").OperationalEvent; entityIds: Record<string, string>; memoryIds: string[] } })).filter(({ payload }) => Date.parse(payload.event.eventTime) <= at.getTime()).sort((a, b) => Date.parse(a.payload.event.eventTime) - Date.parse(b.payload.event.eventTime) || a.record.id.localeCompare(b.record.id));
  for (const { record, payload } of ordered) {
    const { event, entityIds } = payload;
    // Governance is evaluated now, even for historical reads. Missing/rejected admission fails closed.
    const incidents = event.entities.filter(entity => entity.type === "Incident");
    const incidentIds = incidents.map(entity => entityIds[entity.sourceId]);
    const admitted = payload.memoryIds.length >= incidents.length && payload.memoryIds.every(id => visibility.memoryIds.has(id));
    for (const entity of event.entities) {
      const id = entityIds[entity.sourceId], prior = permitted.get(id);
      if (!prior || (entity.type === "Incident" && !admitted)) continue;
      nodes.set(id, { ...prior, title: entity.title, summary: entity.summary ?? null, validFrom: new Date(event.eventTime), metadata: { operational: true, source: event.source, sourceId: entity.sourceId, sourceEventId: record.id, eventTime: event.eventTime, evidence: event.evidence, facts: entity.facts, memoryId: entity.type === "Incident" ? payload.memoryIds[incidentIds.indexOf(id)] : null } });
    }
    for (const relation of event.relationships) {
      const fromObjectId = entityIds[relation.from], toObjectId = entityIds[relation.to];
      const id = operationalId("relationship", fromObjectId, toObjectId, relation.type);
      if (Date.parse(relation.validFrom) > at.getTime() || (relation.validTo && Date.parse(relation.validTo) <= at.getTime())) { edges.delete(id); continue; }
      edges.set(id, { id, fromObjectId, toObjectId, type: relation.type, weight: relation.confidence, metadata: { operational: true, source: event.source, eventTime: event.eventTime, evidence: relation.evidence, confidence: relation.confidence, validFrom: relation.validFrom, validTo: relation.validTo ?? null } });
    }
  }
  return { nodes: [...nodes.values()], edges: [...edges.values()].filter(edge => nodes.has(edge.fromObjectId) && nodes.has(edge.toObjectId)), partial: events.length > 500 || current.length === 1200 || visibility.memoryIds.size === 2000 };
}
