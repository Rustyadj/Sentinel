import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Only the session is faked; authorization runs the real permission code
// against the database. The seeded "default" workspace is owned by
// seed@sentinel.test (scripts/test/seed-test-db.sh).
const session = vi.hoisted(() => ({ email: null as string | null }));
vi.mock("@/auth", () => ({
  auth: async () => (session.email ? { user: { id: "ignored", email: session.email } } : null),
  handlers: {}, signIn: vi.fn(), signOut: vi.fn(),
}));

const INSTANCE_OWNER = "seed@sentinel.test";
import { db } from "@/lib/db";
import * as listRoute from "@/app/api/modules/custom/route";
import * as itemRoute from "@/app/api/modules/custom/[id]/route";
import * as moduleRoute from "@/app/api/modules/[moduleId]/route";

const json = (body: unknown, method = "POST") =>
  new Request("http://x/api", { method, headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
const ctx = (id: string) => ({ params: Promise.resolve({ id }) });
const created: string[] = [];

async function createModule(body: Record<string, unknown> = { label: "Sec test" }) {
  const res = await listRoute.POST(json(body));
  expect(res.status).toBe(201);
  const mod = await res.json() as { id: string; moduleId: string };
  created.push(mod.id);
  return mod;
}

const suffix = `${process.pid}-${Date.now().toString(36)}`;
const selfMadeOwner = `own-workspace-${suffix}@example.com`;

beforeAll(async () => {
  // Owns a workspace of their own — which any signed-in user can create —
  // and nothing else. Must not be able to change instance-wide settings.
  const user = await db.user.create({ data: { email: selfMadeOwner } });
  await db.workspace.create({ data: { slug: `self-made-${suffix}`, name: "Mine", ownerId: user.id } });
});
beforeEach(() => { session.email = INSTANCE_OWNER; });
afterAll(async () => {
  await db.customModule.deleteMany({ where: { id: { in: created } } });
  await db.workspace.deleteMany({ where: { slug: `self-made-${suffix}` } });
  await db.user.deleteMany({ where: { email: selfMadeOwner } });
});

describe("PUT /api/modules/custom/[id] mass assignment", () => {
  it("rejects server-owned columns instead of writing them", async () => {
    const mod = await createModule();
    for (const field of [{ moduleId: "hijacked" }, { href: "https://evil.example" }, { config: { x: 1 } }, { id: "other" }]) {
      const res = await itemRoute.PUT(json(field, "PUT"), ctx(mod.id));
      expect(res.status, JSON.stringify(field)).toBe(400);
    }
    const stored = await db.customModule.findUniqueOrThrow({ where: { id: mod.id } });
    expect(stored.moduleId).toBe(mod.moduleId);
    expect(stored.href).toBeNull();
  });

  it("still applies allowlisted fields", async () => {
    const mod = await createModule();
    const res = await itemRoute.PUT(json({ label: "Renamed", enabled: false, order: 5 }, "PUT"), ctx(mod.id));
    expect(res.status).toBe(200);
    const stored = await db.customModule.findUniqueOrThrow({ where: { id: mod.id } });
    expect(stored).toMatchObject({ label: "Renamed", enabled: false, order: 5 });
  });

  it("refuses a non-https iframe src, including via a content-only update", async () => {
    expect((await listRoute.POST(json({ label: "x", contentType: "iframe", content: "javascript:alert(1)" }))).status).toBe(400);
    const mod = await createModule({ label: "Frame", contentType: "iframe", content: "https://example.com" });
    const res = await itemRoute.PUT(json({ content: "http://example.com" }, "PUT"), ctx(mod.id));
    expect(res.status).toBe(400);
  });

  it("keeps owners of other workspaces and anonymous callers out", async () => {
    const mod = await createModule();
    session.email = selfMadeOwner;
    expect((await itemRoute.PUT(json({ label: "x" }, "PUT"), ctx(mod.id))).status).toBe(403);
    expect((await itemRoute.DELETE(json({}, "DELETE"), ctx(mod.id))).status).toBe(403);
    expect((await listRoute.POST(json({ label: "x" }))).status).toBe(403);
    expect((await moduleRoute.PUT(json({ enabled: false }, "PUT"), { params: Promise.resolve({ moduleId: "kanban" }) })).status).toBe(403);
    session.email = null;
    expect((await itemRoute.PUT(json({ label: "x" }, "PUT"), ctx(mod.id))).status).toBe(401);
  });

  it("returns 404 for an unknown module", async () => {
    expect((await itemRoute.PUT(json({ label: "x" }, "PUT"), ctx("missing"))).status).toBe(404);
  });
});
