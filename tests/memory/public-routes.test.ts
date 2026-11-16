// Public memory routes, end to end against the real handlers and a real
// database. Only the session is faked.
//
// Each public route that writes durable memory is exercised as the three
// callers that matter: nobody, a stranger, and someone entitled. The point is
// not that the happy path works — it did before — but that the authorised
// pipeline (src/lib/neural-engine/memory-write.ts) is what decides, and that a
// request body cannot choose its own owner, scope or tenant.
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
import * as reflect from "@/app/api/memories/reflect/route";
import * as preferences from "@/app/api/learning/preferences/route";
import { ensureSystemRoles, ensureMemberAccess, ensureOperatorRole } from "@/lib/workspaces/permissions-catalog";
import { remember } from "@/lib/neural-engine/memory-ingestion";
import { memoryWriter, MemoryWriteDenied } from "@/lib/neural-engine/memory-write";

const P = `pr-${Date.now().toString(36)}`;
const u = { owner: `${P}-owner`, member: `${P}-member`, operator: `${P}-operator`, stranger: `${P}-stranger` };
const ws2 = `${P}-ws2`;
const ws = `${P}-ws`;
const strangerWs = `${P}-ws-stranger`;
const project = `${P}-proj`;
const strangerProject = `${P}-proj-stranger`;

const req = (url: string, body?: unknown, method = "POST") =>
  new Request(`http://x${url}`, { method, headers: { "content-type": "application/json" }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const as = (userId: string) => { session.userId = userId; };

async function post(body: Record<string, unknown>) {
  const response = await collection.POST(req("/api/memories", { type: "fact", scope: "user", source: "test", content: "Deploys happen on Tuesdays after review.", ...body }) as never);
  return { status: response.status, body: await response.json() };
}
const patch = async (id: string, body: unknown) => {
  const response = await item.PATCH(req(`/api/memories/${id}`, body, "PATCH") as never, ctx(id));
  return { status: response.status, body: response.status === 204 ? null : await response.json() };
};
const del = async (id: string) => (await item.DELETE(req(`/api/memories/${id}`, undefined, "DELETE") as never, ctx(id))).status;
const row = (id: string) => db.memory.findUnique({ where: { id } });

beforeAll(async () => {
  for (const id of Object.values(u)) await db.user.create({ data: { id, email: `${id}@sentinel.test`, name: id } });
  await db.workspace.create({ data: { id: ws, slug: ws, name: "PR", ownerId: u.owner } });
  await db.workspace.create({ data: { id: strangerWs, slug: strangerWs, name: "PR other", ownerId: u.stranger } });
  await ensureSystemRoles(ws);
  await ensureMemberAccess(ws, u.member);
  const operatorRole = await ensureOperatorRole(ws);
  await db.roleAssignment.create({ data: { workspaceId: ws, roleId: operatorRole.id, userId: u.operator } });
  await db.workspace.create({ data: { id: ws2, slug: ws2, name: "PR second", ownerId: u.owner } });
  await db.project.create({ data: { id: project, name: "PR", userId: u.owner, workspaceId: ws } });
  await db.project.create({ data: { id: strangerProject, name: "PR other", userId: u.stranger, workspaceId: strangerWs } });
});
beforeEach(() => as(u.owner));
afterAll(async () => {
  const owners = Object.values(u);
  const memoryIds = (await db.memory.findMany({ where: { owner: { in: owners } }, select: { id: true } })).map((m) => m.id);
  await db.knowledgeObject.deleteMany({ where: { sourceType: "memory", sourceId: { in: memoryIds } } });
  await db.userPreferenceEvidence.deleteMany({ where: { userId: { in: owners } } });
  await db.memoryIngestionDecision.deleteMany({ where: { owner: { in: owners } } });
  await db.memory.deleteMany({ where: { owner: { in: owners } } });
  await db.project.deleteMany({ where: { id: { in: [project, strangerProject] } } });
  for (const w of [ws, ws2, strangerWs]) {
    await db.roleAssignment.deleteMany({ where: { workspaceId: w } });
    await db.role.deleteMany({ where: { workspaceId: w } });
    await db.permission.deleteMany({ where: { workspaceId: w } });
  }
  await db.workspace.deleteMany({ where: { id: { in: [ws, ws2, strangerWs] } } });
  await db.user.deleteMany({ where: { id: { in: owners } } });
});

describe("POST /api/memories", () => {
  it("rejects an anonymous caller", async () => {
    as("");
    expect((await post({})).status).toBe(401);
  });

  it("rejects a body that is not JSON or misses required fields", async () => {
    const bad = await collection.POST(new Request("http://x/api/memories", { method: "POST", body: "{" }) as never);
    expect(bad.status).toBe(400);
    expect((await post({ content: "" })).status).toBe(400);
  });

  it("stores personal memory as the caller, whatever owner the body names", async () => {
    const { status, body } = await post({ owner: u.stranger, provenanceClass: "GENERALIZED", shadowOnly: true });
    expect(status).toBe(201);
    const stored = await row(body.id);
    expect(stored?.owner).toBe(u.owner);
    expect(stored?.provenanceClass).toBe("USER_PROVIDED");
    expect(stored?.shadowOnly).toBe(false);
  });

  it("refuses secret-shaped content before anything is written", async () => {
    const before = await db.memory.count({ where: { owner: u.owner } });
    const { status, body } = await post({ content: "The staging api_key=sk-live-abcdef1234567890 works." });
    expect(status).toBe(400);
    expect(body.code).toBe("secret_content");
    expect(await db.memory.count({ where: { owner: u.owner } })).toBe(before);
  });

  it("refuses scopes that need a workspace-aware writer", async () => {
    for (const scope of ["workspace", "organization", "org", "public", "global", "agent", "bot"]) {
      expect((await post({ scope })).status, scope).toBe(400);
    }
  });

  it("writes project memory for someone with project.update", async () => {
    const { status, body } = await post({ scope: "project", projectId: project });
    expect(status).toBe(201);
    expect((await row(body.id))?.projectId).toBe(project);
  });

  it("answers a project the caller cannot write with 404, not a 500 or a row", async () => {
    const before = await db.memory.count({ where: { projectId: strangerProject } });
    const { status } = await post({ scope: "project", projectId: strangerProject });
    expect(status).toBe(404);
    expect(await db.memory.count({ where: { projectId: strangerProject } })).toBe(before);
  });

  it("clamps scores the body supplies to [0, 1]", async () => {
    const { body } = await post({ confidence: 7, importanceScore: -3 });
    const stored = await row(body.id);
    expect(stored?.confidence).toBe(1);
    expect(stored?.importanceScore).toBe(0);
  });
});

describe("PATCH /api/memories/:id", () => {
  it("lets the owner edit user-editable fields only", async () => {
    const { body: created } = await post({});
    const { status } = await patch(created.id, {
      pinned: true, tags: ["edited"], owner: u.stranger, scope: "project", projectId: strangerProject, workspaceId: strangerWs, state: "stable",
    });
    expect(status).toBe(200);
    const stored = await row(created.id);
    expect(stored).toMatchObject({ pinned: true, tags: ["edited"], owner: u.owner, scope: "user", projectId: null, workspaceId: null });
    expect(stored?.state).not.toBe("stable");
  });

  it("gives a stranger 404 and leaves the row alone", async () => {
    const { body: created } = await post({ content: "Owner-only memory about release cadence." });
    as(u.stranger);
    expect((await patch(created.id, { content: "rewritten by a stranger" })).status).toBe(404);
    expect((await row(created.id))?.content).toBe("Owner-only memory about release cadence.");
  });

  it("refuses to store a secret through an edit", async () => {
    const { body: created } = await post({});
    const { status, body } = await patch(created.id, { content: "password: hunter2-correct-horse" });
    expect(status).toBe(400);
    expect(body.code).toBe("secret_content");
    expect((await row(created.id))?.content).not.toContain("hunter2");
  });

  it("lets a workspace member without project.update read but not edit project memory", async () => {
    const { body: created } = await post({ scope: "project", projectId: project, content: "Project memory the member may read." });
    as(u.member);
    const read = await item.GET(req(`/api/memories/${created.id}`, undefined, "GET") as never, ctx(created.id));
    // Member holds project.read but not project.update (that is Operator).
    expect(read.status).toBe(200);
    expect((await patch(created.id, { pinned: true })).status).toBe(404);
    expect(await del(created.id)).toBe(404);
    expect((await row(created.id))?.pinned).toBe(false);
  });

  it("answers a missing id with 404", async () => {
    expect((await patch(`${P}-missing`, { pinned: true })).status).toBe(404);
  });
});

describe("DELETE /api/memories/:id", () => {
  it("gives a stranger 404 and keeps the row", async () => {
    const { body: created } = await post({});
    as(u.stranger);
    expect(await del(created.id)).toBe(404);
    expect(await row(created.id)).not.toBeNull();
  });

  it("deletes for the owner", async () => {
    const { body: created } = await post({});
    expect(await del(created.id)).toBe(204);
    expect(await row(created.id)).toBeNull();
  });

  it("rejects an anonymous caller", async () => {
    const { body: created } = await post({});
    as("");
    expect(await del(created.id)).toBe(401);
  });
});

describe("POST /api/memories/reflect", () => {
  it("archives the caller's duplicates and never touches another user's rows", async () => {
    const text = "Reflect probe: the build cache lives in the shared volume.";
    const a = (await post({ content: text })).body;
    const b = (await post({ content: text })).body;
    as(u.stranger);
    const theirs = (await post({ content: text })).body;
    const theirsDup = (await post({ content: text })).body;
    as(u.owner);
    const response = await reflect.POST();
    expect(response.status).toBe(200);
    const [ra, rb, rt, rtd] = await Promise.all([row(a.id), row(b.id), row(theirs.id), row(theirsDup.id)]);
    expect([ra?.archived, rb?.archived].filter(Boolean)).toHaveLength(1);
    expect(rt?.archived).toBe(false);
    expect(rtd?.archived).toBe(false);
  });
});

describe("POST /api/learning/preferences", () => {
  const evidence = (body: Record<string, unknown>) =>
    preferences.POST(req("/api/learning/preferences", { key: `${P}-tone`, value: "concise", sourceType: "explicit_user_statement", evidence: "User said: keep it short.", ...body }));

  it("records preference memory owned by the caller even if the body names someone else", async () => {
    const response = await evidence({ userId: u.stranger });
    expect(response.status).toBe(201);
    const { memory } = await response.json();
    expect(memory.owner).toBe(u.owner);
  });

  it("refuses evidence against a workspace the caller cannot write", async () => {
    const response = await evidence({ key: `${P}-other`, workspaceId: strangerWs });
    expect(response.status).toBe(403);
    expect(await db.memory.count({ where: { source: { contains: `${P}-other` } } })).toBe(0);
  });

  it("places workspace preference memory in that workspace", async () => {
    const response = await evidence({ key: `${P}-ws-pref`, workspaceId: ws });
    expect(response.status).toBe(201);
    const { memory } = await response.json();
    expect(memory).toMatchObject({ scope: "workspace", workspaceId: ws });
  });

  it("lets an Operator (role holder, not the workspace owner) record workspace preferences", async () => {
    as(u.operator);
    const response = await evidence({ key: `${P}-op-pref`, workspaceId: ws });
    expect(response.status).toBe(201);
    expect((await response.json()).memory).toMatchObject({ owner: u.operator, workspaceId: ws });
  });

  it("refuses workspace preferences for a plain Member, who lacks project.update", async () => {
    as(u.member);
    expect((await evidence({ key: `${P}-member-pref`, workspaceId: ws })).status).toBe(403);
  });

  it("keeps one canonical preference per workspace and one personal, never shared", async () => {
    const key = `${P}-per-ws`;
    const a = await (await evidence({ key, value: "concise", workspaceId: ws })).json();
    const b = await (await evidence({ key, value: "detailed", workspaceId: ws2 })).json();
    const personal = await (await evidence({ key, value: "terse" })).json();
    expect(new Set([a.memory.id, b.memory.id, personal.memory.id]).size).toBe(3);
    expect(b.conflict).toBe(false);
    expect(b.memory).toMatchObject({ workspaceId: ws2, content: "detailed" });
    expect(personal.memory).toMatchObject({ scope: "user", workspaceId: null });
    // Recording in ws2 did not move ws's preference.
    expect((await row(a.memory.id))?.confidence).toBe(a.memory.confidence);
  });

  it("refuses secret-shaped preference values", async () => {
    const response = await evidence({ key: `${P}-secret`, value: "token: ghp_abcdefghijklmnop1234" });
    expect(response.status).toBe(400);
  });
});

describe("the gated pipeline (remember) behind bot memory", () => {
  it("refuses project memory in a project the owner cannot write", async () => {
    await expect(remember({
      content: "The deploy checklist requires a database backup before migrating.",
      owner: u.owner, scope: "project", projectId: strangerProject, speaker: "agent",
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(await db.memory.count({ where: { projectId: strangerProject, owner: u.owner } })).toBe(0);
  });

  it("accepts project memory where the owner may write", async () => {
    const result = await remember({
      content: "The deploy checklist requires a database backup before migrating.",
      owner: u.owner, scope: "project", projectId: project, speaker: "user", skipReconsolidation: true,
    });
    expect(result.accepted).toBe(true);
  });
});

describe("service writers", () => {
  it("bound each service to the columns it maintains", async () => {
    const { body: created } = await post({});
    expect(() => memoryWriter("governance").update({ where: { id: created.id }, data: { content: "rewritten" } }))
      .toThrow(MemoryWriteDenied);
    expect(() => memoryWriter("usage").update({ where: { id: created.id }, data: { owner: u.stranger } }))
      .toThrow(/move memory between scopes/);
    expect(() => memoryWriter("governance").create({ data: { type: "fact", scope: "user", owner: u.owner, content: "x", source: "t" } }))
      .toThrow(/may not create/);
    await memoryWriter("governance").update({ where: { id: created.id }, data: { state: "stale" } });
    expect((await row(created.id))?.state).toBe("stale");
  });
});
