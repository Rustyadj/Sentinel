// Memory tenant isolation.
//
// Until migration 20260920160000, Memory had no workspaceId and retrieval
// isolated workspace-scoped rows by `owner`. That passed a leakage test while
// providing the wrong guarantee: user A could not see user C's workspace
// memory even though both are members of the same workspace, so isolation was
// really owner-isolation wearing a workspace's name.
//
// These tests are written to fail in both directions — a leak, and a member
// who cannot see what they are entitled to — because either one means the
// scope does not mean what it says.

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { retrieveContext } from "@/lib/knowledge/retrieval";
import { readableWorkspaceIds, assertWritableMemoryScope, MemoryScopeError } from "@/lib/knowledge/memory-scope";
import { ensureSystemRoles, ensureMemberAccess } from "@/lib/workspaces/permissions-catalog";

const WS_A = "iso-ws-a";
const WS_B = "iso-ws-b";
const PROJ_A = "iso-proj-a";
const PROJ_B = "iso-proj-b";
const USER_A = "iso-user-a";
const USER_B = "iso-user-b";
const USER_C = "iso-user-c"; // a second, legitimate member of workspace A
const USER_D = "iso-user-d"; // a member of nothing

const MEMORY_IDS = [
  "iso-mem-ws-a", "iso-mem-ws-b", "iso-mem-proj-a", "iso-mem-proj-b", "iso-mem-ws-a-by-c",
];

async function cleanup() {
  await db.memoryReconsolidation.deleteMany({ where: { memoryId: { in: MEMORY_IDS } } });
  await db.memoryRetrieval.deleteMany({ where: { memoryId: { in: MEMORY_IDS } } });
  await db.memory.deleteMany({ where: { id: { in: MEMORY_IDS } } });
  await db.roleAssignment.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
  await db.role.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
  await db.permission.deleteMany({ where: { workspaceId: { in: [WS_A, WS_B] } } });
  await db.project.deleteMany({ where: { id: { in: [PROJ_A, PROJ_B] } } });
  await db.workspace.deleteMany({ where: { id: { in: [WS_A, WS_B] } } });
  await db.user.deleteMany({ where: { id: { in: [USER_A, USER_B, USER_C, USER_D] } } });
}

/** Everything in these fixtures says "rotation schedule", so no case can pass
 *  because ranking failed to find the other tenant's memory. A leak has to be
 *  prevented by the boundary, not by the query missing. */
const SHARED_SUBJECT = "The API key rotation schedule";

beforeAll(async () => {
  await cleanup();
  for (const id of [USER_A, USER_B, USER_C, USER_D]) {
    await db.user.create({ data: { id, email: `${id}@sentinel.test`, name: id } });
  }
  await db.workspace.create({ data: { id: WS_A, slug: WS_A, name: "A", ownerId: USER_A } });
  await db.workspace.create({ data: { id: WS_B, slug: WS_B, name: "B", ownerId: USER_B } });
  await db.project.create({ data: { id: PROJ_A, name: "A", userId: USER_A, workspaceId: WS_A } });
  await db.project.create({ data: { id: PROJ_B, name: "B", userId: USER_B, workspaceId: WS_B } });

  await ensureSystemRoles(WS_A);
  await ensureSystemRoles(WS_B);
  await ensureMemberAccess(WS_A, USER_C);

  const base = { type: "fact", source: "test", tags: [], confidence: 0.9 };
  await db.memory.createMany({
    data: [
      { ...base, id: "iso-mem-ws-a", owner: USER_A, scope: "workspace", workspaceId: WS_A, projectId: null,
        content: `${SHARED_SUBJECT} in workspace A is every 30 days.` },
      { ...base, id: "iso-mem-ws-a-by-c", owner: USER_C, scope: "workspace", workspaceId: WS_A, projectId: null,
        content: `${SHARED_SUBJECT} for workspace A vault access is reviewed quarterly.` },
      { ...base, id: "iso-mem-ws-b", owner: USER_B, scope: "workspace", workspaceId: WS_B, projectId: null,
        content: `${SHARED_SUBJECT} in workspace B is every 90 days.` },
      { ...base, id: "iso-mem-proj-a", owner: USER_A, scope: "project", workspaceId: WS_A, projectId: PROJ_A,
        content: `${SHARED_SUBJECT} for project A is enforced by a nightly job.` },
      { ...base, id: "iso-mem-proj-b", owner: USER_B, scope: "project", workspaceId: WS_B, projectId: PROJ_B,
        content: `${SHARED_SUBJECT} for project B is enforced manually.` },
    ],
  });
});

afterAll(cleanup);

const QUERY = "What is the API key rotation schedule?";

async function idsFor(userId: string, opts: { projectId?: string; workspaceId?: string } = {}) {
  const result = await retrieveContext({
    userId, query: QUERY, scopePolicy: "user-context", maxItems: 50, ...opts,
  });
  return result.memories.map((memory) => memory.id);
}

describe("cross-tenant isolation", () => {
  it("A cannot retrieve B's workspace memory", async () => {
    expect(await idsFor(USER_A, { workspaceId: WS_A })).not.toContain("iso-mem-ws-b");
  });

  it("A cannot retrieve B's project memory", async () => {
    expect(await idsFor(USER_A, { projectId: PROJ_A, workspaceId: WS_A })).not.toContain("iso-mem-proj-b");
  });

  it("B cannot retrieve A's memory", async () => {
    const ids = await idsFor(USER_B, { workspaceId: WS_B });
    expect(ids).not.toContain("iso-mem-ws-a");
    expect(ids).not.toContain("iso-mem-ws-a-by-c");
    expect(ids).not.toContain("iso-mem-proj-a");
  });

  it("knowing another workspace's id confers no access", async () => {
    // B names A's workspace explicitly. The id is real and correct; B is not a
    // member. Naming it must yield nothing, and must NOT silently fall back to
    // "everything B can read" — a rejected request must never become a wider one.
    const ids = await idsFor(USER_B, { workspaceId: WS_A });
    expect(ids).not.toContain("iso-mem-ws-a");
    expect(ids).not.toContain("iso-mem-ws-b");
  });

  it("knowing another project's id confers no access", async () => {
    expect(await idsFor(USER_B, { projectId: PROJ_A, workspaceId: WS_A })).not.toContain("iso-mem-proj-a");
  });

  it("a user who is a member of nothing retrieves no workspace memory", async () => {
    expect(await idsFor(USER_D, { workspaceId: WS_A })).toEqual([]);
  });
});

describe("legitimate sharing inside one workspace", () => {
  it("a second member of workspace A sees workspace A memory, including another member's", async () => {
    const ids = await idsFor(USER_C, { workspaceId: WS_A });
    expect(ids).toContain("iso-mem-ws-a");
    expect(ids).toContain("iso-mem-ws-a-by-c");
  });

  it("but still not workspace B's", async () => {
    expect(await idsFor(USER_C, { workspaceId: WS_A })).not.toContain("iso-mem-ws-b");
  });

  it("project-scoped memory still obeys project permissions, not workspace membership", async () => {
    // C is a member of workspace A, which owns project A. That does not make
    // project A's memory C's to read — project scope is a narrower grant, and
    // widening it is not something workspace membership should do implicitly.
    expect(await idsFor(USER_C, { projectId: PROJ_A, workspaceId: WS_A })).not.toContain("iso-mem-proj-a");
  });

  it("resolves exactly the workspaces a user may read", async () => {
    expect(await readableWorkspaceIds(USER_A)).toEqual([WS_A]);
    expect(await readableWorkspaceIds(USER_B)).toEqual([WS_B]);
    expect(await readableWorkspaceIds(USER_C)).toEqual([WS_A]);
    expect(await readableWorkspaceIds(USER_D)).toEqual([]);
  });
});

describe("unresolved workspace memory fails closed", () => {
  it("is unreachable rather than global", async () => {
    await db.memory.update({ where: { id: "iso-mem-ws-a" }, data: { workspaceId: null } });
    try {
      // A owns it and owns the workspace. It is still unreachable, because the
      // row no longer says which workspace it belongs to and retrieval will
      // not infer one.
      expect(await idsFor(USER_A, { workspaceId: WS_A })).not.toContain("iso-mem-ws-a");
      // And it certainly has not become visible to another tenant.
      expect(await idsFor(USER_B, { workspaceId: WS_B })).not.toContain("iso-mem-ws-a");
    } finally {
      await db.memory.update({ where: { id: "iso-mem-ws-a" }, data: { workspaceId: WS_A } });
    }
  });
});

describe("authorization-aware writes", () => {
  it("refuses a workspace-scoped memory with no workspace", async () => {
    await expect(assertWritableMemoryScope({ userId: USER_A, scope: "workspace", workspaceId: null }))
      .rejects.toThrow(MemoryScopeError);
  });

  it("refuses a write into a workspace the user is not a member of", async () => {
    await expect(assertWritableMemoryScope({ userId: USER_B, scope: "workspace", workspaceId: WS_A }))
      .rejects.toThrow(/Not authorised/);
  });

  it("refuses a project/workspace pair that disagree", async () => {
    await expect(
      assertWritableMemoryScope({ userId: USER_A, scope: "project", workspaceId: WS_A, projectId: PROJ_B }),
    ).rejects.toThrow(/does not belong to that workspace/);
  });

  it("allows an owner to write into their own workspace", async () => {
    await expect(assertWritableMemoryScope({ userId: USER_A, scope: "workspace", workspaceId: WS_A }))
      .resolves.toBeUndefined();
  });
});
