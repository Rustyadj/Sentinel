// Memory -> graph bridge (the /api/memories mutations).
// A graph node is a second place a memory's text lives, so it has to obey the
// memory's own access rules: owned by the memory's owner, removed when the memory
// goes, not left behind when it is archived, and never created for a memory
// the caller could not have written.
import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "" }));
vi.mock("@/lib/current-user", () => ({
  requireUser: async () => {
    if (!session.userId) throw new Error("Unauthorized");
    return { id: session.userId, email: `${session.userId}@sentinel.test`, name: session.userId };
  },
}));

import { db } from "@/lib/db";
import * as collection from "@/app/api/memories/route";
import * as item from "@/app/api/memories/[id]/route";
import { getKnowledgeObject, listKnowledgeObjects } from "@/lib/knowledge/objects";
import { syncMemoryToGraph } from "@/lib/knowledge/entity-sync";
import { ensureSystemRoles, ensureMemberAccess } from "@/lib/workspaces/permissions-catalog";

const P = `gb-${Date.now().toString(36)}`;
const u = { owner: `${P}-owner`, editor: `${P}-editor`, stranger: `${P}-stranger` };
const ws = `${P}-ws`; const project = `${P}-proj`; const editorProject = `${P}-proj-editor`;

const json = (body: unknown, method = "POST") => new Request("http://x/api/memories", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const node = (memoryId: string) => db.knowledgeObject.findFirst({ where: { sourceType: "memory", sourceId: memoryId } });
const created: string[] = [];

beforeAll(async () => {
  for (const id of Object.values(u)) await db.user.create({ data: { id, email: `${id}@sentinel.test`, name: id } });
  await db.workspace.create({ data: { id: ws, slug: ws, name: "GB", ownerId: u.owner } });
  await ensureSystemRoles(ws);
  await ensureMemberAccess(ws, u.editor);
  await db.project.create({ data: { id: project, name: "GB", userId: u.owner, workspaceId: ws } });
  // The editor owns this project, so may edit its memories — including ones the workspace owner wrote.
  await db.project.create({ data: { id: editorProject, name: "GB editor", userId: u.editor, workspaceId: ws } });
});
beforeEach(() => { session.userId = u.owner; });
afterAll(async () => {
  await db.knowledgeObject.deleteMany({ where: { sourceType: "memory", sourceId: { in: created } } });
  await db.memory.deleteMany({ where: { id: { in: created } } });
  await db.project.deleteMany({ where: { id: { in: [project, editorProject] } } });
  await db.roleAssignment.deleteMany({ where: { workspaceId: ws } });
  await db.role.deleteMany({ where: { workspaceId: ws } });
  await db.permission.deleteMany({ where: { workspaceId: ws } });
  await db.workspace.deleteMany({ where: { id: ws } });
  await db.user.deleteMany({ where: { id: { in: Object.values(u) } } });
});

async function post(body: Record<string, unknown>) {
  const response = await collection.POST(json({ type: "fact", scope: "user", source: "test", content: "Bridge probe memory.", ...body }) as never);
  const memory = await response.json();
  if (memory.id) created.push(memory.id);
  return { status: response.status, memory };
}

describe("creating a memory", () => {
  it("gives it a graph node owned by the memory's owner and visible only to them", async () => {
    const { status, memory } = await post({ content: "Owner-only graph probe about hurricane framing." });
    expect(status).toBe(201);
    const n = await node(memory.id);
    expect(n).toMatchObject({ type: "Memory", scope: "user", userId: u.owner, projectId: null });
    expect(await getKnowledgeObject(n!.id, u.owner)).not.toBeNull();
    expect(await getKnowledgeObject(n!.id, u.stranger)).toBeNull();
    expect((await listKnowledgeObjects({ userId: u.stranger })).some((o: { id: string }) => o.id === n!.id)).toBe(false);
  });

  it("a project memory is a project-scoped node; an unauthenticated or unauthorised caller makes none", async () => {
    const ok = await post({ scope: "project", projectId: project, content: "Project graph probe about the pour schedule." });
    expect(ok.status).toBe(201);
    expect(await node(ok.memory.id)).toMatchObject({ scope: "project", projectId: project });

    session.userId = "";
    await expect(collection.POST(json({ type: "fact", scope: "user", source: "t", content: "anon" }) as never)).resolves.toMatchObject({ status: 401 });
    session.userId = u.stranger;
    const before = await db.knowledgeObject.count({ where: { sourceType: "memory" } });
    const denied = await collection.POST(json({ type: "fact", scope: "project", projectId: project, source: "t", content: "Not allowed project write." }) as never).catch(() => null);
    expect(denied === null || denied.status >= 400).toBe(true);
    expect(await db.knowledgeObject.count({ where: { sourceType: "memory" } })).toBe(before);
  });

  it("refuses scopes that need the workspace-aware model, without creating a node", async () => {
    const before = await db.knowledgeObject.count({ where: { sourceType: "memory" } });
    const response = await collection.POST(json({ type: "fact", scope: "workspace", source: "t", content: "ws" }) as never);
    expect(response.status).toBe(400);
    expect(await db.knowledgeObject.count({ where: { sourceType: "memory" } })).toBe(before);
  });
});

describe("editing a memory", () => {
  it("re-syncs the node's text, and a teammate's edit does not take the node from its owner", async () => {
    const { memory } = await post({ scope: "project", projectId: editorProject, content: "Original project fact about slab curing." });
    expect(memory.owner).toBe(u.owner);
    // The node did not exist yet (e.g. a memory created before the bridge): the first sync happens on a teammate's edit.
    await db.knowledgeObject.deleteMany({ where: { sourceType: "memory", sourceId: memory.id } });
    session.userId = u.editor;
    const response = await item.PATCH(json({ content: "Edited project fact about slab curing." }, "PATCH") as never, ctx(memory.id));
    expect(response.status).toBe(200);
    const n = await node(memory.id);
    expect(n?.title).toBe("Edited project fact about slab curing.");
    expect(n?.userId).toBe(u.owner);          // the memory's owner, not whoever edited it
  });

  it("archiving removes the node and un-archiving restores it", async () => {
    const { memory } = await post({ content: "Archive probe memory." });
    expect(await node(memory.id)).not.toBeNull();
    await item.PATCH(json({ archived: true }, "PATCH") as never, ctx(memory.id));
    expect(await node(memory.id)).toBeNull();
    await item.PATCH(json({ archived: false }, "PATCH") as never, ctx(memory.id));
    expect(await node(memory.id)).not.toBeNull();
  });

  it("a caller who cannot access the memory changes neither it nor its node", async () => {
    const { memory } = await post({ content: "Private owner memory that must not be editable." });
    session.userId = u.stranger;
    expect((await item.PATCH(json({ content: "hijacked" }, "PATCH") as never, ctx(memory.id))).status).toBe(404);
    expect((await item.DELETE(json({}, "DELETE") as never, ctx(memory.id))).status).toBe(404);
    expect((await node(memory.id))?.title).toBe("Private owner memory that must not be editable.");
    expect(await db.memory.findUnique({ where: { id: memory.id } })).not.toBeNull();
  });
});

describe("deleting a memory", () => {
  it("removes its graph node and edges with it", async () => {
    const { memory } = await post({ content: "Delete probe memory." });
    const n = await node(memory.id);
    const other = await db.knowledgeObject.create({ data: { type: "Task", title: "linked", sourceType: "task", sourceId: `${P}-t`, scope: "global", userId: u.owner } });
    await db.knowledgeEdge.create({ data: { fromObjectId: other.id, toObjectId: n!.id, type: "related_to" } });
    expect(await db.knowledgeEdge.count({ where: { toObjectId: n!.id } })).toBe(1);
    expect((await item.DELETE(json({}, "DELETE") as never, ctx(memory.id))).status).toBe(204);
    expect(await node(memory.id)).toBeNull();
    expect(await db.knowledgeEdge.count({ where: { OR: [{ fromObjectId: n!.id }, { toObjectId: n!.id }] } })).toBe(0);
    await db.knowledgeObject.deleteMany({ where: { id: other.id } });
  });
});

describe("the sync function itself", () => {
  it("never leaves an archived memory in the graph", async () => {
    const memory = { id: `${P}-direct`, content: "direct", scope: "user", owner: u.owner, source: "t", tags: [], projectId: null };
    expect(await syncMemoryToGraph(memory)).toEqual(expect.any(String));
    expect(await syncMemoryToGraph({ ...memory, archived: true })).toBeNull();
    expect(await node(memory.id)).toBeNull();
  });
});
