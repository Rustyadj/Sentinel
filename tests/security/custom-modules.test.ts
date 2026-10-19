import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ role: "owner" as "owner" | "admin" | "member" | null }));
vi.mock("@/lib/agents/permissions", async () => {
  const { canEditConfig } = await import("@/lib/agents/policy");
  return {
    canEditConfig,
    getControlPlaneUser: async () => (session.role ? { id: "u", email: "t@t", role: session.role, workspaceId: "w" } : null),
    forbidden: (action: string) => Response.json({ error: `Forbidden: ${action}` }, { status: 403 }),
    unauthorized: () => Response.json({ error: "Unauthorized" }, { status: 401 }),
  };
});

import { db } from "@/lib/db";
import * as listRoute from "@/app/api/modules/custom/route";
import * as itemRoute from "@/app/api/modules/custom/[id]/route";

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

beforeEach(() => { session.role = "owner"; });
afterAll(async () => { await db.customModule.deleteMany({ where: { id: { in: created } } }); });

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

  it("keeps member and anonymous callers out", async () => {
    const mod = await createModule();
    session.role = "member";
    expect((await itemRoute.PUT(json({ label: "x" }, "PUT"), ctx(mod.id))).status).toBe(403);
    session.role = null;
    expect((await itemRoute.PUT(json({ label: "x" }, "PUT"), ctx(mod.id))).status).toBe(401);
  });

  it("returns 404 for an unknown module", async () => {
    expect((await itemRoute.PUT(json({ label: "x" }, "PUT"), ctx("missing"))).status).toBe(404);
  });
});
