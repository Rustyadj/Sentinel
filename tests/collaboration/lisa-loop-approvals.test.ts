// An approval authorizes exactly one execution of exactly the action the human saw
// (src/lib/orchestration/approval-binding.ts). These drive Lisa's two gates directly —
// the risk gate and the Guardian gate — against a real database, the way startTask
// calls them: one actionClearance() per execution.
import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";

const guardian = vi.hoisted(() => ({ calls: [] as Array<{ humanAuthorized?: boolean }> }));
vi.mock("@/lib/learning/guardian", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/learning/guardian")>();
  return {
    ...actual,
    evaluateGuardian: async (input: Parameters<typeof actual.evaluateGuardian>[0]) => {
      guardian.calls.push({ humanAuthorized: input.humanAuthorized });
      return actual.evaluateGuardian(input);
    },
  };
});

import type { Task } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveGuardianReview } from "@/lib/learning/guardian";
import { consumeApproval, fingerprintAction, type GatedAction } from "@/lib/orchestration/approval-binding";
import { actionClearance, ensureApprovalCleared, ensureGuardianCleared } from "@/lib/orchestration/lisa-loop";
import { createRoomTask } from "@/lib/orchestration/task-router";
import { decideApproval } from "@/lib/workspaces/approvals";
import { makeUser, makeWorkspace } from "../neural-engine/db-setup";

afterAll(async () => db.$disconnect());
beforeEach(() => { guardian.calls.length = 0; });

const HIGH_RISK = "Run prisma migrate deploy against production";
const MEDIUM_RISK = "Deploy the staging preview";

async function setUp(title = HIGH_RISK) {
  const user = await makeUser();
  await makeWorkspace(user.id, "Approval binding workspace");
  const room = await db.chatRoom.create({ data: { name: "Approval binding room", userId: user.id, agentIds: ["hermes-lisa", "codex"] } });
  const task = await createRoomTask({
    chatRoomId: room.id, title, description: "Apply the pending schema change.", createdByAgentId: "hermes-lisa",
    ownerAgentId: "codex", capabilities: ["devops", "backend"], fileScope: ["prisma/migrations/**", "prisma/schema.prisma"],
  });
  return { user, room, task };
}

const reload = (task: Task) => db.task.findUniqueOrThrow({ where: { id: task.id } });
const requestsFor = (task: Task) => db.approvalRequest.findMany({ where: { taskId: task.id }, orderBy: { createdAt: "asc" } });

describe("fingerprintAction", () => {
  const action: GatedAction = {
    taskId: "t1", runtimeKind: "codex", agentId: "codex", title: "Ship it", description: "now",
    fileScope: ["b/**", "a/**"], capabilities: ["testing", "backend"], command: "Ship it",
  };

  it("is stable across the order of file scope and capabilities", () => {
    expect(fingerprintAction(action)).toBe(fingerprintAction({ ...action, fileScope: ["a/**", "b/**"], capabilities: ["backend", "testing"] }));
    expect(fingerprintAction(action)).toMatch(/^[0-9a-f]{64}$/);
  });

  it("changes when any part of the action changes", () => {
    const base = fingerprintAction(action);
    const variants: Partial<GatedAction>[] = [
      { taskId: "t2" }, { runtimeKind: "claude-code" }, { agentId: "claude-code" }, { title: "Ship it!" },
      { description: null }, { description: "later" }, { fileScope: ["a/**"] }, { capabilities: ["backend"] }, { command: "rm -rf /" },
    ];
    for (const variant of variants) expect(fingerprintAction({ ...action, ...variant }), JSON.stringify(variant)).not.toBe(base);
  });
});

describe("the risk gate", () => {
  it("lets an approved task run once; running it again asks for a new approval", async () => {
    const { user, room, task } = await setUp();

    const first = actionClearance(task, "codex");
    expect(await ensureApprovalCleared(room.id, task, first)).toBe(false);
    const [pending] = await requestsFor(task);
    expect(pending).toMatchObject({ status: "pending", actionFingerprint: first.fingerprint, consumedAt: null });
    expect((await reload(task)).status).toBe("APPROVAL_REQUIRED");
    await decideApproval(pending.id, "approved", user.id);

    const run = actionClearance(task, "codex");
    expect(run.fingerprint).toBe(first.fingerprint);
    expect(await ensureApprovalCleared(room.id, task, run)).toBe(true);
    const spent = await db.approvalRequest.findUniqueOrThrow({ where: { id: pending.id } });
    expect(spent.consumedAt).not.toBeNull();
    expect(spent.consumedByRunId).toBe(run.runId);
    // The same execution checking again keeps what it already spent.
    expect(await ensureApprovalCleared(room.id, task, run)).toBe(true);

    // A retry or rerun is a new execution: the spent approval does not clear it.
    const rerun = actionClearance(task, "codex");
    expect(await ensureApprovalCleared(room.id, task, rerun)).toBe(false);
    const after = await requestsFor(task);
    expect(after).toHaveLength(2);
    expect(after[1]).toMatchObject({ status: "pending", actionFingerprint: rerun.fingerprint, consumedAt: null });
    // While that one is pending, asking again does not pile up duplicates.
    expect(await ensureApprovalCleared(room.id, task, actionClearance(task, "codex"))).toBe(false);
    expect(await requestsFor(task)).toHaveLength(2);
  });

  it("does not clear a task whose description was edited after the approval", async () => {
    const { user, room, task } = await setUp();
    expect(await ensureApprovalCleared(room.id, task, actionClearance(task, "codex"))).toBe(false);
    const [approved] = await requestsFor(task);
    await decideApproval(approved.id, "approved", user.id);

    const edited = await db.task.update({ where: { id: task.id }, data: { description: "Apply the pending schema change, then drop the audit table." } });
    const clearance = actionClearance(edited, "codex");
    expect(clearance.fingerprint).not.toBe(approved.actionFingerprint);
    expect(await ensureApprovalCleared(room.id, edited, clearance)).toBe(false);

    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approved.id } })).consumedAt).toBeNull();
    const [, fresh] = await requestsFor(task);
    expect(fresh).toMatchObject({ status: "pending", actionFingerprint: clearance.fingerprint });
  });

  it("does not clear the same task moved to another runtime", async () => {
    const { user, room, task } = await setUp();
    expect(await ensureApprovalCleared(room.id, task, actionClearance(task, "codex"))).toBe(false);
    const [approved] = await requestsFor(task);
    await decideApproval(approved.id, "approved", user.id);
    expect(await ensureApprovalCleared(room.id, task, actionClearance(task, "claude-code"))).toBe(false);
  });

  it("never treats a legacy approval without a fingerprint as clearing anything", async () => {
    const { user, room, task } = await setUp();
    const legacy = await db.approvalRequest.create({ data: { workspaceId: (await db.workspace.findFirstOrThrow({ where: { ownerId: user.id } })).id, title: "old", type: "agent_execution", taskId: task.id, chatRoomId: room.id, status: "approved" } });
    expect(await ensureApprovalCleared(room.id, task, actionClearance(task, "codex"))).toBe(false);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: legacy.id } })).consumedAt).toBeNull();
  });
});

describe("spending an approval", () => {
  it("lets exactly one of several concurrent executions spend it", async () => {
    const { user, room, task } = await setUp();
    const clearance = actionClearance(task, "codex");
    await ensureApprovalCleared(room.id, task, clearance);
    const [approval] = await requestsFor(task);
    await decideApproval(approval.id, "approved", user.id);

    const runs = Array.from({ length: 6 }, (_, i) => `run-${i}`);
    const results = await Promise.all(runs.map((runId) => consumeApproval({ taskId: task.id, actionFingerprint: clearance.fingerprint, runId })));
    const winners = results.filter((result) => result !== null);
    expect(winners).toHaveLength(1);
    const spent = await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
    expect(spent.consumedByRunId).toBe(winners[0]!.consumedByRunId);
  });

  it("spends a pending or rejected approval never", async () => {
    const { user, room, task } = await setUp();
    const clearance = actionClearance(task, "codex");
    await ensureApprovalCleared(room.id, task, clearance);
    expect(await consumeApproval({ taskId: task.id, actionFingerprint: clearance.fingerprint, runId: "r" })).toBeNull();
    const [approval] = await requestsFor(task);
    await decideApproval(approval.id, "rejected", user.id);
    expect(await consumeApproval({ taskId: task.id, actionFingerprint: clearance.fingerprint, runId: "r" })).toBeNull();
  });
});

describe("the Guardian gate", () => {
  it("does not count an unrelated earlier approval on the task as human authorization at Tier 3", async () => {
    const { user, room, task } = await setUp();
    const workspaceId = (await db.workspace.findFirstOrThrow({ where: { ownerId: user.id } })).id;
    const otherAction = fingerprintAction({
      taskId: task.id, runtimeKind: "codex", agentId: "codex", title: "Run the read-only report", description: null,
      fileScope: [], capabilities: [], command: "Run the read-only report",
    });
    const unrelated = await Promise.all([
      db.approvalRequest.create({ data: { workspaceId, title: "earlier, different action", type: "agent_execution", taskId: task.id, chatRoomId: room.id, status: "approved", actionFingerprint: otherAction } }),
      db.approvalRequest.create({ data: { workspaceId, title: "legacy approval", type: "agent_execution", taskId: task.id, chatRoomId: room.id, status: "approved" } }),
    ]);

    const clearance = actionClearance(task, "codex");
    expect(await ensureGuardianCleared({ roomId: room.id }, task, "codex", clearance)).toBe(false);
    expect(guardian.calls).toEqual([{ humanAuthorized: false }]);
    for (const approval of unrelated) expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).consumedAt).toBeNull();
    const gated = await db.approvalRequest.findFirstOrThrow({ where: { taskId: task.id, actionFingerprint: clearance.fingerprint } });
    expect(gated.status).toBe("pending");
    expect((await reload(task)).status).toBe("APPROVAL_REQUIRED");

    // Approving THIS action authorizes it — once.
    await decideApproval(gated.id, "approved", user.id);
    guardian.calls.length = 0;
    const run = actionClearance(task, "codex");
    expect(await ensureGuardianCleared({ roomId: room.id }, task, "codex", run)).toBe(true);
    expect(guardian.calls).toEqual([{ humanAuthorized: true }]);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: gated.id } })).consumedByRunId).toBe(run.runId);

    guardian.calls.length = 0;
    expect(await ensureGuardianCleared({ roomId: room.id }, task, "codex", actionClearance(task, "codex"))).toBe(false);
    expect(guardian.calls).toEqual([{ humanAuthorized: false }]);
  });

  it("a resolved Tier 2 hold clears one execution of that action", async () => {
    const { user, room, task } = await setUp(MEDIUM_RISK);
    expect(await ensureGuardianCleared({ roomId: room.id }, task, "codex", actionClearance(task, "codex"))).toBe(false);
    const [held] = await requestsFor(task);
    const guardianDecisionId = (held.payload as { guardianDecisionId?: string }).guardianDecisionId;
    expect(typeof guardianDecisionId).toBe("string");
    // Waiting on the human does not mint another hold.
    expect(await ensureGuardianCleared({ roomId: room.id }, task, "codex", actionClearance(task, "codex"))).toBe(false);
    expect(await requestsFor(task)).toHaveLength(1);

    await decideApproval(held.id, "approved", user.id);
    await resolveGuardianReview({ decisionId: guardianDecisionId!, reviewerId: user.id, approve: true });
    expect(await ensureGuardianCleared({ roomId: room.id }, task, "codex", actionClearance(task, "codex"))).toBe(true);

    // The next execution starts a fresh review.
    expect(await ensureGuardianCleared({ roomId: room.id }, task, "codex", actionClearance(task, "codex"))).toBe(false);
    const after = await requestsFor(task);
    expect(after).toHaveLength(2);
    expect(after[1].status).toBe("pending");
  });

  it("a refused Tier 2 review stays refused for that action", async () => {
    const { user, room, task } = await setUp(MEDIUM_RISK);
    await ensureGuardianCleared({ roomId: room.id }, task, "codex", actionClearance(task, "codex"));
    const [held] = await requestsFor(task);
    await decideApproval(held.id, "rejected", user.id);
    guardian.calls.length = 0;
    expect(await ensureGuardianCleared({ roomId: room.id }, task, "codex", actionClearance(task, "codex"))).toBe(false);
    expect(guardian.calls).toHaveLength(0);
    expect(await requestsFor(task)).toHaveLength(1);
  });
});
