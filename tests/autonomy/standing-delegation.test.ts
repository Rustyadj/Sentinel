// Standing delegation against a real (throwaway) Postgres: grants are spent
// atomically, revocation and budgets are enforced, tenants are isolated, and
// the two production gates that used to ask a human for every action —
// Lisa's room approval gate and the objective engine — now honour grants and
// name exactly what authority is missing when none applies.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { authorizeOperation, createGrant, revokeGrant } from "@/lib/autonomy/authority-store";
import { updateAutonomySettings } from "@/lib/autonomy/settings-store";
import { actionClearance, ensureApprovalCleared } from "@/lib/orchestration/lisa-loop";
import { createRoomTask } from "@/lib/orchestration/task-router";
import { advanceObjective } from "@/lib/objectives/engine";
import { createObjective } from "@/lib/objectives/service";
import type { ToolDeps } from "@/lib/objectives/tools";

const P = `auto-${Date.now().toString(36)}`;
const ids = { owner: `${P}-owner`, other: `${P}-other`, ws: `${P}-ws`, ws2: `${P}-ws2`, wsBaseline: `${P}-ws3` };

beforeAll(async () => {
  for (const id of [ids.owner, ids.other]) await db.user.create({ data: { id, email: `${id}@sentinel.test`, name: id } });
  await db.workspace.create({ data: { id: ids.ws, slug: ids.ws, name: "Autonomy", ownerId: ids.owner } });
  await db.workspace.create({ data: { id: ids.ws2, slug: ids.ws2, name: "Other tenant", ownerId: ids.other } });
  await db.workspace.create({ data: { id: ids.wsBaseline, slug: ids.wsBaseline, name: "No grants", ownerId: ids.other } });
});

afterAll(async () => {
  for (const workspaceId of [ids.ws, ids.ws2, ids.wsBaseline]) {
    await db.approvalRequest.deleteMany({ where: { workspaceId } });
    await db.auditLog.deleteMany({ where: { workspaceId } });
    await db.objective.deleteMany({ where: { workspaceId } });
  }
  await db.chatRoom.deleteMany({ where: { userId: { in: [ids.owner, ids.other] } } });
  await db.workspace.deleteMany({ where: { id: { in: [ids.ws, ids.ws2, ids.wsBaseline] } } });
  await db.user.deleteMany({ where: { id: { in: [ids.owner, ids.other] } } });
  await db.$disconnect();
});

const request = (overrides: Partial<Parameters<typeof authorizeOperation>[0]> = {}) => ({ workspaceId: ids.ws, agentId: "codex", operation: "write" as const, ...overrides });

describe("authority store", () => {
  it("spends a grant once per action, records provenance, and reuses the use on retry", async () => {
    const grant = await createGrant({ workspaceId: ids.ws, grantedByUserId: ids.owner, operations: ["routine"], agentId: "codex", maxUses: 2 });
    const first = await authorizeOperation(request(), { type: "task", id: "t1", correlationId: "fp-1" });
    expect(first).toMatchObject({ authorized: true });
    expect(first.grant?.id).toBe(grant.id);
    const retry = await authorizeOperation(request(), { type: "task", id: "t1", correlationId: "fp-1" });
    expect(retry.useId).toBe(first.useId);
    expect((await db.authorityGrant.findUniqueOrThrow({ where: { id: grant.id } })).usesCount).toBe(1);

    await authorizeOperation(request(), { type: "task", id: "t2", correlationId: "fp-2" });
    const exhausted = await authorizeOperation(request(), { type: "task", id: "t3", correlationId: "fp-3" });
    expect(exhausted.authorized).toBe(false);
    expect(exhausted.missing).toMatch(/use limit reached/);
    const uses = await db.authorityGrantUse.findMany({ where: { grantId: grant.id } });
    expect(uses.map((u) => u.subjectId).sort()).toEqual(["t1", "t2"]);
  });

  it("revocation is enforced immediately", async () => {
    const grant = await createGrant({ workspaceId: ids.ws, grantedByUserId: ids.owner, operations: ["exec"], agentId: "gemini" });
    expect((await authorizeOperation(request({ agentId: "gemini", operation: "exec" }), { type: "task", id: "r1" })).authorized).toBe(true);
    expect(await revokeGrant({ grantId: grant.id, workspaceId: ids.ws, userId: ids.owner })).toBe(true);
    const after = await authorizeOperation(request({ agentId: "gemini", operation: "exec" }), { type: "task", id: "r2" });
    expect(after.authorized).toBe(false);
    // Even a retry of an action the grant cleared before revocation is not re-authorized by it.
    expect((await authorizeOperation(request({ agentId: "gemini", operation: "exec" }), { type: "task", id: "r1" })).authorized).toBe(false);
  });

  it("budgets are respected: spending stops at the grant's budget", async () => {
    await createGrant({ workspaceId: ids.ws, grantedByUserId: ids.owner, operations: ["financial"], agentId: "buyer", budgetCents: 1_500 });
    const spend = (id: string, costCents: number) => authorizeOperation(request({ agentId: "buyer", operation: "financial", costCents }), { type: "objective_step", id, correlationId: id });
    expect((await spend("b1", 1_000)).authorized).toBe(true);
    const over = await spend("b2", 600);
    expect(over.authorized).toBe(false);
    expect(over.missing).toMatch(/budget exhausted/);
    expect((await spend("b3", 500)).authorized).toBe(true);
  });

  it("tenant isolation: one workspace's grants never authorize another's actions", async () => {
    await createGrant({ workspaceId: ids.ws2, grantedByUserId: ids.other, operations: ["routine", "deploy"] });
    const crossTenant = await authorizeOperation(request({ agentId: "isolated-agent", operation: "deploy" }), { type: "task", id: "x1" });
    expect(crossTenant.authorized).toBe(false);
  });

  it("switching standing delegation off for an agent sends it back to per-action approval", async () => {
    await createGrant({ workspaceId: ids.ws, grantedByUserId: ids.owner, operations: ["routine"], agentId: "cautious" });
    await updateAutonomySettings({ workspaceId: ids.ws, agentId: "cautious", patch: { standingDelegation: false }, userId: ids.owner });
    const outcome = await authorizeOperation(request({ agentId: "cautious" }), { type: "task", id: "c1" });
    expect(outcome).toMatchObject({ authorized: false, delegationDisabled: true });
  });
});

describe("Lisa's room approval gate", () => {
  async function roomTask(title: string, capabilities = ["backend"]) {
    const room = await db.chatRoom.create({ data: { name: `${P} room`, userId: ids.owner, agentIds: ["hermes-lisa", "codex"] } });
    const task = await createRoomTask({ chatRoomId: room.id, title, description: "Implement it.", createdByAgentId: "hermes-lisa", ownerAgentId: "codex", capabilities, fileScope: ["src/feature/**"] });
    return { room, task };
  }

  it("without standing authority it still asks — and the request names the missing authority", async () => {
    const { room, task } = await roomTask("Add the export endpoint", ["frontend"]);
    expect(await ensureApprovalCleared(room.id, task, actionClearance(task, "codex"))).toBe(false);
    const [approval] = await db.approvalRequest.findMany({ where: { taskId: task.id } });
    expect((approval.payload as Record<string, unknown>).missingAuthority).toMatch(/No standing authority covers "write" for agent codex/);
  });

  it("standing authority eliminates the repeated approval for authorized routine work", async () => {
    const grant = await createGrant({ workspaceId: ids.ws, grantedByUserId: ids.owner, operations: ["routine"], agentId: "codex", capabilities: ["backend", "testing"] });
    let prompts = 0;
    for (const title of ["Add the import endpoint", "Write tests for import", "Refactor the import parser"]) {
      const { room, task } = await roomTask(title, ["backend", "testing"]);
      const cleared = await ensureApprovalCleared(room.id, task, actionClearance(task, "codex"));
      expect(cleared, title).toBe(true);
      prompts += await db.approvalRequest.count({ where: { taskId: task.id } });
    }
    expect(prompts).toBe(0);
    expect(await db.authorityGrantUse.count({ where: { grantId: grant.id, subjectType: "task" } })).toBe(3);
  });

  it("a routine grant does not cover a task whose content implies destructive or deploy authority", async () => {
    const { room, task } = await roomTask("Clean up: rm -rf the old build dirs", ["backend", "testing"]);
    expect(await ensureApprovalCleared(room.id, task, actionClearance(task, "codex"))).toBe(false);
    const [approval] = await db.approvalRequest.findMany({ where: { taskId: task.id } });
    expect((approval.payload as Record<string, unknown>).missingAuthority).toMatch(/"destructive"/);
  });
});

describe("objective engine", () => {
  const deps: ToolDeps = {
    fetch: async () => new Response("", { status: 503 }), resolveMx: async () => [], resolveTxt: async () => [],
    dispatchAgentRun: async () => "run-1", getAgentRun: async () => ({ status: "running", text: null, error: null, costCents: 0 }),
  };
  const goal = "Create a new business called Atlas Forge with a domain, email, website and CRM.";

  async function approvalsAfterAdvance(workspaceId: string, userId: string) {
    const objective = await createObjective(userId, { workspaceId, goal, autonomyLevel: 3, budgetCents: 10_000 });
    await advanceObjective(objective.id, deps);
    await advanceObjective(objective.id, deps);
    const stepRows = await db.objectiveStep.findMany({ where: { objectiveId: objective.id }, select: { id: true, key: true, status: true } });
    const approvals = await db.approvalRequest.count({ where: { type: "objective_step", taskId: { in: stepRows.map((row) => row.id) } } });
    return { objective, approvals, statuses: Object.fromEntries(stepRows.map((row) => [row.key, row.status])) };
  }

  it("a delegate grant clears Managed-mode agent steps without per-step approval; the budget gate is untouched", async () => {
    const baseline = await approvalsAfterAdvance(ids.wsBaseline, ids.other);
    await createGrant({ workspaceId: ids.ws, grantedByUserId: ids.owner, operations: ["delegate"] });
    const withGrant = await approvalsAfterAdvance(ids.ws, ids.owner);
    expect(baseline.statuses.website_build, JSON.stringify(baseline.statuses)).toBe("waiting_approval");
    expect(withGrant.statuses.website_build, JSON.stringify(withGrant.statuses)).not.toBe("waiting_approval");
    expect(withGrant.approvals).toBeLessThan(baseline.approvals);
    const events = await db.objectiveEvent.findMany({ where: { objectiveId: withGrant.objective.id, type: "authority.applied" } });
    expect(events.length).toBeGreaterThan(0);
    // Every grant-cleared step is attributable to the grant that cleared it.
    for (const event of events) expect((event.data as Record<string, unknown>).grantId).toBeTruthy();
  });
});
