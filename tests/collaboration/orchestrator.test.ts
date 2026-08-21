import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeUser, makeWorkspace } from "../neural-engine/db-setup";
import { setRuntimeAdapterForTests } from "@/lib/agents/runtime/service";
import { toAgentSession } from "@/lib/agents/runtime/store";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeKind,
  RuntimeEvent,
  SendTaskInput,
  StartSessionInput,
} from "@/lib/agents/runtime/types";

const currentUser = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUser: currentUser.requireUser }));

// Import after the mock so the orchestrator (via requireRuntimeAccess ->
// requireWorkspacePermission -> requireUser) resolves to the mocked user.
const { runCollaborationTurn, resumeAfterApproval } = await import("@/lib/orchestration/orchestrator");

afterAll(async () => db.$disconnect());
beforeEach(() => currentUser.requireUser.mockReset());

/** A scripted reply queue per runtime kind so a test can control what each
 *  agent "says" turn by turn (e.g. plan, implement, review). */
function scriptedAdapter(kind: AgentRuntimeKind, replies: string[]): AgentRuntimeAdapter {
  let call = 0;
  const nextReply = () => replies[Math.min(call++, replies.length - 1)];

  return {
    kind,
    async discover() {
      return { found: true, kind, instances: [] };
    },
    async health() {
      return {
        installed: true, processRunning: true, reachable: true, authenticated: true,
        ready: true, busy: false, degraded: false, checkedAt: new Date().toISOString(),
      };
    },
    async readiness() {
      return { ready: true };
    },
    async startSession(input: StartSessionInput) {
      const runtime = await db.agentRuntime.findUniqueOrThrow({ where: { id: input.runtimeId } });
      const row = await db.agentSession.create({
        data: {
          runtime: kind,
          runtimeInstanceId: input.runtimeId,
          agentId: runtime.agentId,
          userId: input.userId,
          workspaceId: input.workspaceId,
          workingDirectory: input.workingDirectory,
          status: "ready",
        },
      });
      return toAgentSession(row);
    },
    async resumeSession() {
      throw new Error("not used in these tests");
    },
    async *send(input: SendTaskInput): AsyncIterable<RuntimeEvent> {
      yield { type: "assistant_delta", sessionId: input.sessionId, sequence: 1, timestamp: new Date().toISOString(), data: { text: nextReply() } };
    },
    async cancel() {
      return { success: true };
    },
    async getSession() {
      return null;
    },
    async listSessions() {
      return [];
    },
    async getLogs() {
      return { lines: [], hasMore: false };
    },
    async restart() {
      return { success: true };
    },
    async reload() {
      return { success: true };
    },
    async capabilities() {
      return { streaming: true, resume: false, cancel: true, toolEvents: false, fileChangeEvents: false };
    },
  };
}

function planReply(tasks: { title: string; description?: string; capabilities?: string[]; fileScope?: string[]; dependsOn?: number[] }[]): string {
  return "```json\n" + JSON.stringify(tasks.map((t) => ({
    title: t.title, description: t.description ?? t.title, capabilities: t.capabilities ?? [], fileScope: t.fileScope ?? [], dependsOn: t.dependsOn ?? [],
  }))) + "\n```";
}

async function setUpRoom(hermesReplies: string[]) {
  const user = await makeUser();
  const workspace = await makeWorkspace(user.id, "Peer worker test workspace");
  await db.agentRuntime.update({ where: { id: "runtime-hermes-lisa" }, data: { workspaceId: workspace.id } });
  await db.agentRuntime.update({ where: { id: "runtime-claude-code" }, data: { workspaceId: workspace.id } });
  await db.agentRuntime.update({ where: { id: "runtime-codex" }, data: { workspaceId: workspace.id } });
  setRuntimeAdapterForTests("hermes", scriptedAdapter("hermes", hermesReplies));
  currentUser.requireUser.mockResolvedValue(user);

  const room = await db.chatRoom.create({
    data: { name: "Peer worker test room", userId: user.id, agentIds: ["hermes-lisa", "claude-code", "codex"] },
  });
  return { user, workspace, room };
}

describe("collaboration orchestrator — peer-worker routing", () => {
  it("routes independent tasks to different workers based on capability fit, runs them in parallel, and integrates", async () => {
    const { user, room } = await setUpRoom([
      planReply([
        { title: "Build backend service", capabilities: ["backend", "architecture"], fileScope: ["src/lib/orchestration/**"] },
        { title: "Write test coverage", capabilities: ["testing", "debugging"], fileScope: ["tests/orchestration/**"] },
      ]),
      "Integration reconciled.", // used for the integration task's own turn (also routed to claude-code by capability score)
    ]);
    setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", ["Implemented the backend service."]));
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", ["Wrote the test coverage."]));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Build collaborative agent execution" });

    const tasks = await db.task.findMany({ where: { chatRoomId: room.id }, orderBy: { createdAt: "asc" } });
    expect(tasks).toHaveLength(3); // 2 planned + 1 integration task
    const [backendTask, testTask, integrationTask] = tasks;

    expect(backendTask.agentId).toBe("claude-code"); // higher backend/architecture weight
    expect(testTask.agentId).toBe("codex"); // higher testing/debugging weight
    expect(backendTask.status).toBe("COMPLETED");
    expect(testTask.status).toBe("COMPLETED");
    expect(integrationTask.title).toBe("Integrate parallel work");
    expect(integrationTask.dependsOnTaskIds.sort()).toEqual([backendTask.id, testTask.id].sort());
    expect(integrationTask.status).toBe("COMPLETED");

    // Neither worker is permanently a reviewer — no cross-review happened for
    // these low-risk, non-sensitive-scope tasks, so no reviewer was assigned.
    expect(backendTask.reviewerAgentId).toBeNull();
    expect(testTask.reviewerAgentId).toBeNull();

    const claimEvents = await db.collaborationEvent.findMany({ where: { chatRoomId: room.id, type: "task.claimed" } });
    const claimedAgentIds = new Set(claimEvents.map((e) => (e.payload as { agentId?: string }).agentId));
    expect(claimedAgentIds).toEqual(new Set(["claude-code", "codex"])); // dynamic routing, not a fixed split
  });

  it("triggers cross-review for sensitive file scope even when the request text itself reads as low risk", async () => {
    const { user, room } = await setUpRoom([
      planReply([{ title: "Add a column", capabilities: ["database"], fileScope: ["prisma/schema.prisma"] }]),
    ]);
    setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", ["Added the column."]));
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", ["VERDICT: APPROVE\nSchema change looks correct."]));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Add a nullable column to the users table" });

    const task = await db.task.findFirstOrThrow({ where: { chatRoomId: room.id, title: "Add a column" } });
    expect(task.status).toBe("COMPLETED");
    expect(task.reviewerAgentId).not.toBeNull(); // sensitive scope forced a cross-review despite low risk score
    const decisions = await db.decision.findMany({ where: { chatRoomId: room.id, relatedTaskIds: { has: task.id } } });
    expect(decisions).toHaveLength(1);
  });

  it("loops changes-requested up to the cycle limit, then blocks the task and raises a human-resolvable disagreement", async () => {
    const { user, room } = await setUpRoom([
      planReply([{ title: "Refactor the task router", capabilities: ["refactoring", "architecture"], fileScope: ["prisma/schema.prisma"] }]),
    ]);
    setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", ["Refactored the router."]));
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", [
      "VERDICT: CHANGES_REQUESTED\nMissing a test.",
      "VERDICT: CHANGES_REQUESTED\nStill missing a test.",
      "VERDICT: CHANGES_REQUESTED\nStill not addressed.",
      "VERDICT: CHANGES_REQUESTED\nGiving up.",
    ]));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Refactor the task router" });

    const task = await db.task.findFirstOrThrow({ where: { chatRoomId: room.id } });
    expect(task.status).toBe("BLOCKED");
    expect(task.agentId).toBe("claude-code"); // architecture/refactoring favors claude-code

    const disagreements = await db.agentDisagreement.findMany({ where: { chatRoomId: room.id } });
    expect(disagreements).toHaveLength(1);
    expect(disagreements[0]).toMatchObject({ taskId: task.id, severity: "high" });
  });

  it("gates a high-risk request behind an approval request, then resumes and completes it (with cross-review) once approved", async () => {
    const { user, room } = await setUpRoom([
      planReply([{ title: "Run prisma migrate deploy against production", capabilities: ["devops"] }]),
    ]);
    // devops weight favors codex (0.8) over claude-code (0.75), so codex is
    // the owner here and claude-code is the cross-reviewer.
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", ["Migration executed."]));
    setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", ["VERDICT: APPROVE\nSafe to ship."]));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Run prisma migrate deploy against production" });

    let task = await db.task.findFirstOrThrow({ where: { chatRoomId: room.id } });
    expect(task.status).toBe("APPROVAL_REQUIRED");
    expect(task.agentId).toBe("codex");
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });
    expect(approval.risk).toBe("high");
    await db.approvalRequest.update({ where: { id: approval.id }, data: { status: "approved" } });

    await resumeAfterApproval(task.id);

    task = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(task.status).toBe("COMPLETED");
    expect(task.reviewerAgentId).toBe("claude-code"); // high risk always gets a cross-review too
  });

  it("routes a single @mention to a direct reply instead of the plan/dispatch pipeline", async () => {
    const { user, room } = await setUpRoom([]);
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", ["Reviewed the locking approach — it's sound."]));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "@codex what do you think of the locking approach?", recipientAgentIds: ["codex"] });

    expect(await db.task.count({ where: { chatRoomId: room.id } })).toBe(0);
    const reply = await db.message.findFirstOrThrow({ where: { chatRoomId: room.id, messageType: "ANSWER" } });
    expect(reply.agentId).toBe("codex");
    expect(reply.content).toContain("locking approach");
  });
});
