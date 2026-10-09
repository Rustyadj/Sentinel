// The Orrery reads /api/graph/scoped. It is a view of the CURRENT graph: an
// object or edge that has been superseded is history and must not be drawn,
// and the scope is the caller's own objects plus readable projects — nothing else.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { getScopedGraph } from "@/lib/graph/scoped";

const P = `sg-${Date.now().toString(36)}`;
const u = { me: `${P}-me`, other: `${P}-other`, projectOwner: `${P}-powner` };
const project = `${P}-project`;
const obj = (id: string, over: Record<string, unknown> = {}) => ({ id: `${P}-${id}`, type: "Task", title: id, sourceType: "test", sourceId: `${P}-${id}`, scope: "user", userId: u.me, ...over });

beforeAll(async () => {
  for (const id of Object.values(u)) await db.user.create({ data: { id, email: `${id}@sentinel.test`, name: id } });
  await db.project.create({ data: { id: project, name: "SG", userId: u.projectOwner } });
  await db.knowledgeObject.createMany({ data: [
    obj("live-1"), obj("live-2"), obj("live-3"),
    obj("superseded", { validTo: new Date(Date.now() - 60_000) }),
    obj("theirs", { userId: u.other }),
    obj("their-project", { userId: u.projectOwner, scope: "project", projectId: project }),
  ] as never });
  await db.knowledgeEdge.createMany({ data: [
    { id: `${P}-e-live`, fromObjectId: `${P}-live-1`, toObjectId: `${P}-live-2`, type: "related_to" },
    { id: `${P}-e-old`, fromObjectId: `${P}-live-2`, toObjectId: `${P}-live-3`, type: "related_to", validTo: new Date(Date.now() - 60_000) },
    { id: `${P}-e-to-superseded`, fromObjectId: `${P}-live-1`, toObjectId: `${P}-superseded`, type: "related_to" },
    { id: `${P}-e-foreign`, fromObjectId: `${P}-live-1`, toObjectId: `${P}-theirs`, type: "related_to" },
  ] });
});
afterAll(async () => {
  await db.knowledgeObject.deleteMany({ where: { id: { startsWith: P } } });
  await db.project.deleteMany({ where: { id: project } });
  await db.user.deleteMany({ where: { id: { in: Object.values(u) } } });
});

describe("entry view", () => {
  it("returns current objects and edges only", async () => {
    const graph = await getScopedGraph({ userId: u.me, limit: 400 });
    const ids = graph.nodes.map((n) => n.id).filter((id) => id.startsWith(P));
    expect(ids.sort()).toEqual([`${P}-live-1`, `${P}-live-2`, `${P}-live-3`]);
    const edges = graph.edges.map((e) => e.id).filter((id) => id.startsWith(P));
    expect(edges).toEqual([`${P}-e-live`]);
  });

  it("never includes another user's objects or an edge into them", async () => {
    const graph = await getScopedGraph({ userId: u.me, limit: 400 });
    expect(graph.nodes.some((n) => n.id === `${P}-theirs` || n.id === `${P}-their-project`)).toBe(false);
    expect(graph.edges.some((e) => e.id === `${P}-e-foreign`)).toBe(false);
  });

  it("an empty graph is an empty answer", async () => {
    const graph = await getScopedGraph({ userId: u.other, limit: 400, projectId: undefined, types: ["Decision"] });
    expect(graph.nodes).toEqual([]);
    expect(graph.edges).toEqual([]);
    expect(graph.partial).toBe(false);
  });
});

describe("focus view", () => {
  it("does not walk to a superseded neighbour or across a superseded edge", async () => {
    const graph = await getScopedGraph({ userId: u.me, focusId: `${P}-live-1`, depth: 2, limit: 50 });
    const ids = graph.nodes.map((n) => n.id).sort();
    expect(ids).toEqual([`${P}-live-1`, `${P}-live-2`]);
    expect(graph.edges.map((e) => e.id)).toEqual([`${P}-e-live`]);
  });

  it("refuses to focus a superseded object", async () => {
    await expect(getScopedGraph({ userId: u.me, focusId: `${P}-superseded` })).rejects.toThrow(/not found/i);
  });

  it("refuses to focus someone else's object", async () => {
    await expect(getScopedGraph({ userId: u.me, focusId: `${P}-theirs` })).rejects.toThrow(/not found/i);
  });
});
