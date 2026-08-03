import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { RUNTIME_PERMISSIONS, listAuthorizedRuntimes, requireRuntimeAccess } from "@/lib/agents/runtime/authorization";
import { makeUser, makeWorkspace, uid } from "../neural-engine/db-setup";

const currentUser = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUser: currentUser.requireUser }));

beforeEach(() => currentUser.requireUser.mockReset());
afterAll(async () => db.$disconnect());

describe("runtime permission boundaries", () => {
  it("lists only runtimes assigned to a workspace the user can access", async () => {
    const owner = await makeUser(); const outsider = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Runtime tenant");
    await db.agentRuntime.update({ where: { id: "runtime-claude-code" }, data: { workspaceId: workspace.id } });
    currentUser.requireUser.mockResolvedValue(outsider);
    expect((await listAuthorizedRuntimes()).some((runtime) => runtime.id === "runtime-claude-code")).toBe(false);
    currentUser.requireUser.mockResolvedValue(owner);
    expect((await listAuthorizedRuntimes()).some((runtime) => runtime.id === "runtime-claude-code")).toBe(true);
  });

  it("allows an explicitly authorized operator to execute but not elevate or restart", async () => {
    const owner = await makeUser(); const operator = await makeUser();
    const workspace = await makeWorkspace(owner.id, "Runtime operator tenant");
    await db.agentRuntime.update({ where: { id: "runtime-codex" }, data: { workspaceId: workspace.id } });
    const permission = await db.permission.create({
      data: { workspaceId: workspace.id, key: RUNTIME_PERMISSIONS.execute, resource: "agents.runtime", action: "execute" },
    });
    const role = await db.role.create({
      data: { workspaceId: workspace.id, name: uid("runtime-operator"), permissions: { connect: { id: permission.id } } },
    });
    await db.roleAssignment.create({ data: { workspaceId: workspace.id, roleId: role.id, userId: operator.id } });
    currentUser.requireUser.mockResolvedValue(operator);
    await expect(requireRuntimeAccess("runtime-codex", RUNTIME_PERMISSIONS.execute)).resolves.toMatchObject({ user: { id: operator.id } });
    await expect(requireRuntimeAccess("runtime-codex", RUNTIME_PERMISSIONS.elevate)).rejects.toMatchObject({ status: 403 });
    await expect(requireRuntimeAccess("runtime-codex", RUNTIME_PERMISSIONS.restart)).rejects.toMatchObject({ status: 403 });
  });

  it("fails closed for unassigned runtimes even when the caller is authenticated", async () => {
    const user = await makeUser();
    await db.agentRuntime.update({ where: { id: "runtime-openclaw" }, data: { workspaceId: null } });
    currentUser.requireUser.mockResolvedValue(user);
    await expect(requireRuntimeAccess("runtime-openclaw", RUNTIME_PERMISSIONS.view)).rejects.toMatchObject({ status: 403 });
  });
});
