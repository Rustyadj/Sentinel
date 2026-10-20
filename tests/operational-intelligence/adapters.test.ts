import { describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser, makeWorkspace, uid } from "../neural-engine/db-setup";
import { backfillOperationalSources } from "@/lib/knowledge/operational-adapters";
import { operationalSnapshot } from "@/lib/knowledge/operational-graph";
describe("existing operational source adapters", () => {
  it("imports real fixture deployment/health records once and preserves endpoint health timing", async () => {
    const user = await makeUser(), workspace = await makeWorkspace(user.id);
    const project = await db.project.create({ data: { userId: user.id, name: "SYNTHETIC adapter project", workspaceId: workspace.id } });
    const repository = await db.repository.create({ data: { name: "SYNTHETIC repository", projectId: project.id, localPath: uid("synthetic-repo") } });
    const deployment = await db.deployment.create({ data: { repositoryId: repository.id, environment: "synthetic-test", sha: "synthetic-revision", status: "deployed", source: "synthetic-test", observedAt: new Date("2026-09-01T00:00:00Z") } });
    await db.healthCheck.createMany({ data: [{ deploymentId: deployment.id, target: "https://synthetic.test/health", status: "down", checkedAt: new Date("2026-09-01T00:00:00Z"), source: "synthetic-test" }, { deploymentId: deployment.id, target: "https://synthetic.test/health", status: "ok", checkedAt: new Date("2026-09-01T00:05:00Z"), source: "synthetic-test" }] });
    const first = await backfillOperationalSources(user.id, workspace.id, "https://synthetic.test");
    expect(first.ingested).toBe(3);
    expect((await backfillOperationalSources(user.id, workspace.id, "https://synthetic.test")).ingested).toBe(0);
    const snapshot = await operationalSnapshot(user.id, workspace.id);
    expect(snapshot.nodes.find(node => node.type === "Service")?.metadata).toMatchObject({ facts: { status: "healthy" }, eventTime: "2026-09-01T00:05:00.000Z" });
    expect(snapshot.nodes.some(node => node.type === "Incident")).toBe(false);
  });
});

it("derives alert counts and capacity trends only from labeled observations", async () => {
  const { ingestOperationalEvent } = await import("@/lib/knowledge/operational-ingestion");
  const { operationalGraph } = await import("@/lib/knowledge/operational-graph");
  const { syntheticIncident } = await import("./fixtures");
  const user = await makeUser(), workspace = await makeWorkspace(user.id);
  const event = syntheticIncident(1);
  event.entities.push({ sourceId: "team", type: "Team", title: "SYNTHETIC team", facts: { capacityHours: 40, capacityFrom: "2026-09-01T00:00:00Z", capacityTo: "2026-09-08T00:00:00Z" } }, { sourceId: "false-alert", type: "Alert", title: "SYNTHETIC false positive", facts: { classification: "false_positive" } });
  event.relationships.push({ from: "team", to: "gateway", type: "TEAM_OWNS_SERVICE", validFrom: event.eventTime, confidence: 1, evidence: event.evidence }, { from: "synthetic-incident-1", to: "false-alert", type: "INCIDENT_TRIGGERED_ALERT", validFrom: event.eventTime, confidence: 1, evidence: event.evidence });
  await ingestOperationalEvent(user.id, workspace.id, event);
  const teams = await operationalGraph(user.id, workspace.id, "team");
  expect(teams.teams[0].capacityTrend[0]).toMatchObject({ incidentCount: 1, capacityHours: 40, incidentsPerCapacityHour: 0.025 });
  const alerts = await operationalGraph(user.id, workspace.id, "alert");
  expect(alerts.alertAnalytics).toMatchObject({ total: 1, actionable: 0, falsePositives: 1, duplicates: 0 });
  expect(alerts.alertAnalytics.recommendations[0].evidence).toEqual(event.evidence);
});

it("includes a relationship whose validity interval contains now", async () => {
  const { ingestOperationalEvent } = await import("@/lib/knowledge/operational-ingestion");
  const { operationalGraph } = await import("@/lib/knowledge/operational-graph");
  const { syntheticIncident } = await import("./fixtures");
  const user = await makeUser(), workspace = await makeWorkspace(user.id);
  const event = syntheticIncident(1);
  event.relationships[0].validTo = new Date(Date.now() + 86400000).toISOString();
  await ingestOperationalEvent(user.id, workspace.id, event);
  expect((await operationalGraph(user.id, workspace.id, "incident")).edges.some(edge => edge.type === "SERVICE_AFFECTED_BY_INCIDENT")).toBe(true);
});
