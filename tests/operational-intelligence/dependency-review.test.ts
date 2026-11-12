import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser, makeWorkspace } from "../neural-engine/db-setup";
import { ingestOperationalEvent } from "@/lib/knowledge/operational-ingestion";
import { proposeDependencies, reviewDependency, operationalGraph, operationalHistory } from "@/lib/knowledge/operational-graph";
import { syntheticIncident } from "./fixtures";
let user: string, workspace: string;
beforeAll(async () => {
  user = (await makeUser()).id; workspace = (await makeWorkspace(user)).id;
  for (let index = 1; index <= 8; index++) {
    const event = syntheticIncident(index);
    const at = new Date(Date.parse(event.eventTime) + 60000).toISOString();
    event.entities.push({ sourceId: "downstream", type: "Service", title: "SYNTHETIC downstream", facts: {} }, { sourceId: `downstream-incident-${index}`, type: "Incident", title: `SYNTHETIC downstream incident ${index}`, summary: `Downstream failed during gateway incident ${index}`, facts: { startedAt: at, status: "resolved" } });
    event.relationships.push({ from: "downstream", to: `downstream-incident-${index}`, type: "SERVICE_AFFECTED_BY_INCIDENT", validFrom: at, evidence: event.evidence, confidence: 0.9 });
    // Closed historical impact intervals remain evidence for discovery after recovery.
    for (const relation of event.relationships) if (relation.type === "SERVICE_AFFECTED_BY_INCIDENT") relation.validTo = new Date(Date.parse(event.eventTime) + 1200000).toISOString();
    await ingestOperationalEvent(user, workspace, event);
  }
});
describe("inferred relationship review", () => {
  it("persists proposals with evidence without creating a dependency", async () => {
    const result = await proposeDependencies(user, workspace);
    expect(result.proposals.length).toBeGreaterThan(0);
    const graph = await operationalGraph(user, workspace, "dependency");
    expect(graph.edges.some(edge => edge.type === "depends_on")).toBe(false);
    expect(graph.edges.some(edge => (edge.metadata as { status: string }).status === "proposed")).toBe(true);
  });
  it("records rejection and does not recreate or predict from the rejected relation", async () => {
    const graph = await operationalGraph(user, workspace, "dependency");
    const edge = graph.edges.find(item => item.type === "SERVICE_CORRELATED_WITH_SERVICE")!;
    await reviewDependency(user, workspace, edge.id, "rejected");
    await proposeDependencies(user, workspace);
    const after = await operationalGraph(user, workspace, "blast-radius", edge.fromObjectId);
    expect(after.correlations.some(item => item.from === edge.fromObjectId && item.to === edge.toObjectId)).toBe(false);
    expect(await db.knowledgeEvent.count({ where: { workspaceId: workspace, type: "operational.correlation.reviewed" } })).toBe(1);
    await expect(reviewDependency(user, workspace, edge.id, "confirmed")).rejects.toThrow("not found");
  });
  it("confirms an association without claiming dependency causation", async () => {
    const graph = await operationalGraph(user, workspace, "dependency");
    const edge = graph.edges.find(item => item.type === "SERVICE_CORRELATED_WITH_SERVICE")!;
    await reviewDependency(user, workspace, edge.id, "confirmed");
    expect(await db.knowledgeEdge.count({ where: { type: "depends_on", fromObject: { workspaceId: workspace } } })).toBe(0);
    const history = await operationalHistory(user, workspace, edge.fromObjectId);
    expect(history.revisions).toHaveLength(8);
    expect(history.revisions.every(revision => revision.relationships.length > 0)).toBe(true);
  });
});

it("reconstructs service facts at event time instead of displaying the current projection", async () => {
  const { operationalGraphAsOf } = await import("@/lib/knowledge/operational-graph");
  const current = await operationalGraph(user, workspace, "onboarding");
  const gateway = current.nodes.find(node => node.type === "Service" && node.title === "Sentinel gateway")!;
  const old = await operationalGraphAsOf(user, new Date("2026-09-03T12:00:00Z"), workspace);
  const node = old.nodes.find(item => item.id === gateway.id)!;
  expect((node.metadata as { eventTime: string }).eventTime).toBe("2026-09-03T00:00:00.000Z");
  expect(old.nodes.filter(item => item.type === "Incident")).toHaveLength(4);
});
