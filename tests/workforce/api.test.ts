import { randomUUID } from "node:crypto";
import { beforeAll, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { GET } from "@/app/api/workforce/route";
import { POST } from "@/app/api/workforce/departments/route";
import { POST as generatePlan } from "@/app/api/workforce/genesis/route";

const actor = vi.hoisted(() => ({ identity: null as null | { id: string; email: string } }));
vi.mock("@/auth", () => ({ auth: async () => actor.identity ? { user: actor.identity } : null }));

let owner: { id: string; email: string };
let outsider: { id: string; email: string };
let workspaceId: string;
let otherWorkspaceId: string;
let foreignDepartmentId: string;

beforeAll(async () => {
  const key = randomUUID();
  owner = await db.user.create({ data: { email: `workforce-owner-${key}@example.test` } });
  outsider = await db.user.create({ data: { email: `workforce-outsider-${key}@example.test` } });
  const org = await db.organization.create({ data: { name: "Titan ICF", ownerId: owner.id } });
  const other = await db.organization.create({ data: { name: "Other organization", ownerId: outsider.id } });
  const [workspace, otherWorkspace, foreignDepartment] = await Promise.all([
    db.workspace.create({ data: { slug: `workforce-${key}`, name: "Titan Marketing", ownerId: owner.id, organizationId: org.id } }),
    db.workspace.create({ data: { slug: `outside-${key}`, name: "Other Marketing", ownerId: outsider.id, organizationId: other.id } }),
    db.department.create({ data: { name: "Foreign department", organizationId: other.id } }),
  ]);
  workspaceId = workspace.id;
  otherWorkspaceId = otherWorkspace.id;
  foreignDepartmentId = foreignDepartment.id;
  await db.objective.create({
    data: { workspaceId, userId: owner.id, title: "Verify SEO findings", goal: "Review findings", templateKey: "test_fixture" },
  });
});

const request = (body: unknown) => new Request("http://localhost/api/workforce", {
  method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
});
const overview = (id: string) => GET(new Request(`http://localhost/api/workforce?workspaceId=${id}`));

it("enforces workspace scopes on read, department save, and planning", async () => {
  actor.identity = null;
  expect((await overview(workspaceId)).status).toBe(401);
  actor.identity = outsider;
  expect((await overview(workspaceId)).status).toBe(403);
  expect((await POST(request({ workspaceId, name: "Marketing", description: "", parentDepartmentId: null }))).status).toBe(403);
  expect((await generatePlan(request({ workspaceId, instruction: "Plan a workforce." }))).status).toBe(403);
  actor.identity = owner;
  const snapshot = await (await overview(workspaceId)).json();
  expect(snapshot.workspace.organization).toBe("Titan ICF");
  expect(snapshot.objectives).toEqual(expect.arrayContaining([expect.objectContaining({ title: "Verify SEO findings" })]));
  expect((await overview(otherWorkspaceId)).status).toBe(403);
});

it("persists the department hierarchy with an audit record and rejects invalid parents", async () => {
  actor.identity = owner;
  const save = (name: string, parentDepartmentId: string | null, id?: string) => POST(request({ workspaceId, name, description: "", parentDepartmentId, id }));
  expect((await save("Wrong tenant", foreignDepartmentId)).status).toBe(400);
  const rootResponse = await save("Marketing", null);
  expect(rootResponse.status).toBe(201);
  const { department: root } = await rootResponse.json();
  const childResponse = await save("Research", root.id);
  expect(childResponse.status).toBe(201);
  const { department: child } = await childResponse.json();
  expect((await save("Cycle", child.id, root.id)).status).toBe(400);
  expect((await save("Marketing and Sales", null, root.id)).status).toBe(200);
  const { departments } = await (await overview(workspaceId)).json();
  expect(departments).toEqual(expect.arrayContaining([
    expect.objectContaining({ id: child.id, parentDepartmentId: root.id }),
    expect.objectContaining({ id: root.id, name: "Marketing and Sales" }),
  ]));
  expect(await db.auditLog.count({ where: { workspaceId, entityId: root.id, action: "department.updated" } })).toBe(1);
});
