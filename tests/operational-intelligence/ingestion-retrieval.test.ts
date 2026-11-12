import { beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { makeUser, makeWorkspace } from "../neural-engine/db-setup";
import { ingestOperationalEvent, operationalId } from "@/lib/knowledge/operational-ingestion";
import { operationalGraph, filterOperationalNodes } from "@/lib/knowledge/operational-graph";
import { retrieveIncidentHistory } from "@/lib/knowledge/operational-retrieval";
import { retrieveContext } from "@/lib/knowledge/retrieval";
import { operationalEventSchema } from "@/lib/knowledge/operational-types";
import { syntheticIncident } from "./fixtures";
let owner: string, outsider: string, workspace: string;
beforeAll(async () => { owner = (await makeUser()).id; outsider = (await makeUser()).id; workspace = (await makeWorkspace(owner, "SYNTHETIC operational test")).id; });
describe("canonical operational graph persistence", () => {
  it("commits one event and one admitted episodic memory across concurrent retries", async () => {
    const event = syntheticIncident(1);
    const results = await Promise.all([ingestOperationalEvent(owner, workspace, event), ingestOperationalEvent(owner, workspace, event)]);
    expect(results.filter(item => item.duplicate)).toHaveLength(1);
    expect(await db.knowledgeEvent.count({ where: { id: results[0].eventId } })).toBe(1);
    const memories = await db.memory.findMany({ where: { source: `operational:${results[0].eventId}` } });
    expect(memories).toHaveLength(1); expect(memories[0]).toMatchObject({ type: "event", shadowOnly: false, workspaceId: workspace });
    expect(memories[0].content).toContain("unsuccessful");
  });
  it("refuses changed payload under the same source event identity", async () => {
    const event = syntheticIncident(1); event.entities[1].title = "Changed";
    await expect(ingestOperationalEvent(owner, workspace, event)).rejects.toThrow("identity reused");
  });
  it("preserves later entity state during out-of-order backfill and keeps source identity", async () => {
    await ingestOperationalEvent(owner, workspace, syntheticIncident(4));
    await ingestOperationalEvent(owner, workspace, syntheticIncident(2));
    await ingestOperationalEvent(owner, workspace, syntheticIncident(3));
    const service = await db.knowledgeObject.findUniqueOrThrow({ where: { id: operationalId(workspace, "synthetic-test", "gateway") } });
    expect(service.sourceId).toBe("gateway"); expect((service.metadata as { eventTime: string }).eventTime).toBe(syntheticIncident(4).eventTime);
    expect(await db.knowledgeEvent.count({ where: { workspaceId: workspace, type: "operational.ingested" } })).toBe(4);
  });
  it("retrieves the last three incidents by event time with confirmed causes and evidence", async () => {
    const history = await retrieveIncidentHistory({ userId: owner, workspaceId: workspace, query: "What happened the last three times the Sentinel gateway failed?", maxItems: 3 }, { latest: true });
    expect(history.incidents).toHaveLength(3);
    expect(history.incidents.map(item => item.sourceId)).toEqual(["synthetic-incident-4", "synthetic-incident-3", "synthetic-incident-2"]);
    expect(history.incidents[0].resolutionMs).toBe(1200000);
    expect(history.incidents[2].rootCause).toBeNull();
    expect(history.incidents.every(item => item.evidence.length > 0)).toBe(true);
    const context = await retrieveContext({ userId: owner, workspaceId: workspace, query: "Sentinel gateway incident", allowedScopes: ["workspace"] });
    expect(context.memories.some(memory => memory.content.includes("SYNTHETIC"))).toBe(true);
  });
  it("keeps exact service matches above unrelated incidents", async () => {
    const event = syntheticIncident(5, "Billing worker"); event.entities[0].sourceId = "billing"; event.relationships[0].from = "billing";
    await ingestOperationalEvent(owner, workspace, event);
    const history = await retrieveIncidentHistory({ userId: owner, workspaceId: workspace, query: "Sentinel gateway incident" });
    expect(history.incidents.every(item => !item.title.includes("Billing"))).toBe(true);
  });
  it("enforces workspace isolation before deduplication, retrieval and graph reads", async () => {
    await expect(ingestOperationalEvent(outsider, workspace, syntheticIncident(1))).rejects.toThrow("Workspace not found");
    await expect(retrieveIncidentHistory({ userId: outsider, workspaceId: workspace, query: "gateway" })).rejects.toThrow("Workspace not found");
    await expect(operationalGraph(outsider, workspace, "incident")).rejects.toThrow("Workspace not found");
    const otherWorkspace = (await makeWorkspace(owner)).id;
    expect((await ingestOperationalEvent(owner, otherWorkspace, syntheticIncident(1))).duplicate).toBe(false);
  });
  it("does not revive quarantined incidents through retrieval or graph views", async () => {
    const history = await retrieveIncidentHistory({ userId: owner, workspaceId: workspace, query: "Sentinel gateway", maxItems: 20 });
    const incident = history.incidents[0];
    await db.memory.update({ where: { id: incident.memoryId }, data: { state: "quarantined" } });
    const after = await retrieveIncidentHistory({ userId: owner, workspaceId: workspace, query: "Sentinel gateway", maxItems: 20 });
    expect(after.incidents.some(item => item.id === incident.id)).toBe(false);
    expect((await operationalGraph(owner, workspace, "incident")).nodes.some(node => node.id === incident.id)).toBe(false);
    const row = await db.knowledgeObject.findUniqueOrThrow({ where: { id: incident.id } });
    expect(await filterOperationalNodes(owner, [row])).toEqual([]);
  });
  it("rejects malformed intervals, cross-type relationships and secret-shaped envelopes", async () => {
    const event = syntheticIncident(9); event.relationships[0].validTo = event.relationships[0].validFrom;
    expect(operationalEventSchema.safeParse(event).success).toBe(false);
    const secret = syntheticIncident(10); secret.entities[1].summary = "password=synthetic-secret-do-not-store";
    await expect(ingestOperationalEvent(owner, workspace, secret)).rejects.toThrow("Sensitive");
    expect(await db.knowledgeEvent.count({ where: { id: operationalId(workspace, secret.source, secret.sourceEventId) } })).toBe(0);
  });
});

it("reuses an explicitly named canonical service across sources without crossing workspaces", async () => {
  const source = syntheticIncident(4);
  const objectId = operationalId(workspace, source.source, "gateway");
  const event = syntheticIncident(30);
  event.source = "synthetic-second-source";
  event.entities[0].objectId = objectId;
  await ingestOperationalEvent(owner, workspace, event);
  const edge = await db.knowledgeEdge.findFirst({ where: { fromObjectId: objectId, type: "SERVICE_AFFECTED_BY_INCIDENT", toObject: { sourceId: "synthetic-incident-30" } } });
  expect(edge).not.toBeNull();
  const other = await makeWorkspace(owner);
  await expect(ingestOperationalEvent(owner, other.id, event)).rejects.toThrow("Canonical entity not found");
});
