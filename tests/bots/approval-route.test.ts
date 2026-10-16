// A bot's tool approval decided from the generic approvals route — which is what the Orrery's
// approval card calls. It used to flip the row's status and leave the bot task WAITING forever.
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const session = vi.hoisted(() => ({ userId: "", role: "owner" as "owner" | "admin" | "member" }));
vi.mock("@/lib/current-user", () => ({
  requireUser: async () => { if (!session.userId) throw new Error("Unauthorized"); return { id: session.userId, email: "t@t", name: "t" }; },
}));
vi.mock("@/lib/workspaces/authorization", async () => {
  const actual = await vi.importActual<typeof import("@/lib/workspaces/authorization")>("@/lib/workspaces/authorization");
  return { ...actual, requireWorkspacePermission: async (workspaceId: string) => { if (!session.userId) throw new actual.WorkspaceAccessError("Unauthorized", 401); return { id: session.userId, workspaceId }; } };
});
vi.mock("@/lib/agents/permissions", async () => {
  const { canEditConfig } = await import("@/lib/agents/policy");
  return {
    canEditConfig,
    getWorkspaceControlPlaneUser: async (workspaceId: string) => (session.userId ? { id: session.userId, email: "t@t", role: session.role, workspaceId } : null),
    getControlPlaneUser: async () => (session.userId ? { id: session.userId, email: "t@t", role: session.role, workspaceId: null } : null),
    getAccessibleWorkspaceIds: async () => [],
  };
});
vi.mock("@/lib/agents/runtime/service", async () => (await import("./fake-runtime")).serviceMock);
vi.mock("@/lib/orchestration/queue", () => ({ enqueueOrchestrationRun: vi.fn().mockResolvedValue(undefined) }));
vi.mock("@/lib/orchestration/orchestrator", () => ({ resumeAfterApproval: vi.fn(), resumeMissionAfterApproval: vi.fn() }));

import { db } from "@/lib/db";
import * as approvalRoute from "@/app/api/approvals/[id]/route";
import { executeOrchestrationRun } from "@/lib/orchestration/executor";
import { HERMES_BUILTIN_SERVER_ID } from "@/lib/bots/catalog";
import { createBot } from "@/lib/bots/service";
import { delegateToBot, getBotTask } from "@/lib/bots/tasks";
import { botInput, makeWorkspace } from "./fixtures";
import { resetScript, script, toolCall } from "./fake-runtime";

let owner: { id: string }; let workspace: { id: string };
const patch = (id: string, body: unknown) => approvalRoute.PATCH(new Request("http://x", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }) as never, { params: Promise.resolve({ id }) });
const viewer = () => ({ userId: owner.id, isAdmin: true as const });

beforeAll(async () => { ({ owner, workspace } = await makeWorkspace()); });
beforeEach(() => { resetScript(); session.userId = owner.id; session.role = "owner"; });

async function waitingTask() {
  const bot = await createBot(botInput(workspace.id, { status: "active" }), owner.id, { toolGrants: [{ serverId: HERMES_BUILTIN_SERVER_ID, toolName: "terminal", permission: "approval" }] });
  script.events = toolCall("terminal");
  const queued = await delegateToBot(bot.id, { task: "Run the build." }, { kind: "user", userId: owner.id });
  await executeOrchestrationRun(queued.id, `w-${queued.id}`);
  const task = await getBotTask(queued.id, viewer());
  expect(task.status).toBe("WAITING");
  const approval = await db.approvalRequest.findFirstOrThrow({ where: { type: "bot_tool_call", status: "pending", payload: { path: ["runId"], equals: queued.id } } });
  return { bot, task, approval };
}

describe("deciding a bot tool approval from the approvals route", () => {
  it("approving continues the bot as a new task and closes the waiting one", async () => {
    const { task, approval } = await waitingTask();
    const response = await patch(approval.id, { status: "approved" });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("approved");
    expect((await getBotTask(task.id, viewer())).status).toBe("CANCELLED");
    const child = await db.orchestrationRun.findFirstOrThrow({ where: { parentRunId: task.id } });
    expect(child.status).toBe("queued");
    expect((child.request as { approvedTools: string[] }).approvedTools).toEqual([`${HERMES_BUILTIN_SERVER_ID}:terminal`]);
  });

  it("rejecting closes the waiting task and starts nothing", async () => {
    const { task, approval } = await waitingTask();
    const response = await patch(approval.id, { status: "rejected" });
    expect(response.status).toBe(200);
    expect((await response.json()).status).toBe("rejected");
    const closed = await getBotTask(task.id, viewer());
    expect(closed.status).toBe("CANCELLED");
    expect(closed.error).toMatch(/denied/);
    expect(await db.orchestrationRun.count({ where: { parentRunId: task.id } })).toBe(0);
  });

  it("a plain member cannot decide a bot's tool approval, and nothing changes", async () => {
    const { task, approval } = await waitingTask();
    session.role = "member";
    const response = await patch(approval.id, { status: "approved" });
    expect(response.status).toBe(403);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("pending");
    expect((await getBotTask(task.id, viewer())).status).toBe("WAITING");
  });

  it("an approval that was already decided cannot be decided again", async () => {
    const { approval } = await waitingTask();
    expect((await patch(approval.id, { status: "approved" })).status).toBe(200);
    expect((await patch(approval.id, { status: "approved" })).status).toBe(409);
  });

  it("signed-out callers get 401 and an unknown approval does not leak anything", async () => {
    const { approval } = await waitingTask();
    session.userId = "";
    expect((await patch(approval.id, { status: "approved" })).status).toBe(401);
    expect((await patch("no-such-approval", { status: "approved" })).status).toBe(401);   // not a 500 that reveals the id is unknown
    session.userId = owner.id;
    expect((await patch("no-such-approval", { status: "approved" })).status).toBe(404);
  });

  it("if the continuation cannot be created, nothing is decided: the approval stays pending and the task stays waiting, and a retry works", async () => {
    const { bot, task, approval } = await waitingTask();
    await db.bot.update({ where: { id: bot.id }, data: { status: "disabled" } });
    const refused = await patch(approval.id, { status: "approved" });
    expect(refused.status).toBeGreaterThanOrEqual(400);
    expect((await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } })).status).toBe("pending");
    expect((await getBotTask(task.id, viewer())).status).toBe("WAITING");
    expect(await db.orchestrationRun.count({ where: { parentRunId: task.id } })).toBe(0);

    await db.bot.update({ where: { id: bot.id }, data: { status: "active" } });
    expect((await patch(approval.id, { status: "approved" })).status).toBe(200);
    expect(await db.orchestrationRun.count({ where: { parentRunId: task.id } })).toBe(1);
  });

  it("records the reviewer's note and an audit entry, as every other approval does", async () => {
    const { approval } = await waitingTask();
    expect((await patch(approval.id, { status: "rejected", decisionNote: "Not on a Friday." })).status).toBe(200);
    const row = await db.approvalRequest.findUniqueOrThrow({ where: { id: approval.id } });
    expect(row).toMatchObject({ status: "rejected", decisionNote: "Not on a Friday.", reviewerUserId: owner.id });
    const audit = await db.auditLog.findFirst({ where: { approvalRequestId: approval.id, action: "approval.rejected" } });
    expect(audit?.details).toMatchObject({ decisionNote: "Not on a Friday." });
  });
});
