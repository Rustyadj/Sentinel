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
 *  agent "says" turn by turn (e.g. review requests changes, then approves). */
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

async function setUpRoom(reviewReplies: string[]) {
  const user = await makeUser();
  const workspace = await makeWorkspace(user.id, "Collaboration test workspace");
  await db.agentRuntime.update({ where: { id: "runtime-claude-code" }, data: { workspaceId: workspace.id } });
  await db.agentRuntime.update({ where: { id: "runtime-codex" }, data: { workspaceId: workspace.id } });
  setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", ["Implemented the requested change."]));
  setRuntimeAdapterForTests("codex", scriptedAdapter("codex", reviewReplies));
  currentUser.requireUser.mockResolvedValue(user);

  const room = await db.chatRoom.create({
    data: { name: "Collaboration test room", userId: user.id, agentIds: ["hermes-lisa", "claude-code", "codex"] },
  });
  return { user, workspace, room };
}

describe("collaboration orchestrator", () => {
  it("delegates lead -> implementation -> review, completes the task, and records a decision on approval", async () => {
    const { user, room } = await setUpRoom(["VERDICT: APPROVE\nLooks correct."]);

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Add a health check endpoint" });

    const tasks = await db.task.findMany({ where: { chatRoomId: room.id } });
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({ status: "COMPLETED", agentId: "claude-code", reviewerAgentId: "codex", createdByAgentId: "hermes-lisa" });

    const messages = await db.message.findMany({ where: { chatRoomId: room.id }, orderBy: { createdAt: "asc" } });
    expect(messages.map((m) => m.messageType)).toEqual(["MESSAGE", "DELEGATION", "RESULT", "RESULT"]);

    const decisions = await db.decision.findMany({ where: { chatRoomId: room.id } });
    expect(decisions).toHaveLength(1);
    expect(decisions[0]).toMatchObject({ createdBy: "codex", approvedBy: "hermes-lisa", relatedTaskIds: [tasks[0].id] });

    const events = await db.collaborationEvent.findMany({ where: { chatRoomId: room.id }, orderBy: { sequence: "asc" } });
    expect(events.map((e) => e.type)).toEqual([
      "task.created", "task.claimed", "task.started", "artifact.created",
      "task.review_requested", "task.completed", "decision.created",
    ]);
    // Sequence numbers must be gap-free and strictly increasing (spec's event ordering guarantee).
    expect(events.map((e) => e.sequence)).toEqual(events.map((_, i) => i + 1));
  });

  it("loops changes-requested up to the cycle limit, then blocks the task and raises a human-resolvable disagreement", async () => {
    const { user, room } = await setUpRoom([
      "VERDICT: CHANGES_REQUESTED\nMissing a test.",
      "VERDICT: CHANGES_REQUESTED\nStill missing a test.",
      "VERDICT: CHANGES_REQUESTED\nStill not addressed.",
      "VERDICT: CHANGES_REQUESTED\nGiving up.",
    ]);

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Refactor the task router" });

    const task = await db.task.findFirstOrThrow({ where: { chatRoomId: room.id } });
    expect(task.status).toBe("BLOCKED");

    const disagreements = await db.agentDisagreement.findMany({ where: { chatRoomId: room.id } });
    expect(disagreements).toHaveLength(1);
    expect(disagreements[0]).toMatchObject({ taskId: task.id, severity: "high" });
    expect(disagreements[0].positions).toHaveLength(2);

    const changeRequests = await db.message.count({ where: { chatRoomId: room.id, messageType: "CHANGES_REQUESTED" } });
    expect(changeRequests).toBe(4); // MAX_REVIEW_CYCLES (3) + the initial pass that exhausts it
  });

  it("gates a high-risk request behind an approval request and resumes automatically once a human approves it", async () => {
    const { user, room } = await setUpRoom(["VERDICT: APPROVE\nSafe to ship."]);

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Run prisma migrate deploy against production" });

    let task = await db.task.findFirstOrThrow({ where: { chatRoomId: room.id } });
    expect(task.status).toBe("APPROVAL_REQUIRED");
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { chatRoomId: room.id } });
    expect(approval.risk).toBe("high");
    expect(approval.status).toBe("pending");

    await resumeAfterApproval(task.id);

    task = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(task.status).toBe("COMPLETED");
  });

  it("routes a single @mention to a direct reply instead of the full plan/delegate/review pipeline", async () => {
    const { user, room } = await setUpRoom(["VERDICT: APPROVE\nunused"]);
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", ["Reviewed the locking approach — it's sound."]));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "@codex what do you think of the locking approach?", recipientAgentIds: ["codex"] });

    expect(await db.task.count({ where: { chatRoomId: room.id } })).toBe(0);
    const reply = await db.message.findFirstOrThrow({ where: { chatRoomId: room.id, messageType: "ANSWER" } });
    expect(reply.agentId).toBe("codex");
    expect(reply.content).toContain("locking approach");
  });
});
