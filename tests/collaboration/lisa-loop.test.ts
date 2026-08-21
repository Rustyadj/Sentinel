import { afterAll, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { makeUser, makeWorkspace } from "../neural-engine/db-setup";
import { setRuntimeAdapterForTests } from "@/lib/agents/runtime/service";
import { toAgentSession } from "@/lib/agents/runtime/store";
import { acquireExecutionLock } from "@/lib/orchestration/execution-lock";
import type {
  AgentRuntimeAdapter,
  AgentRuntimeKind,
  RuntimeEvent,
  SendTaskInput,
  StartSessionInput,
} from "@/lib/agents/runtime/types";

const currentUser = vi.hoisted(() => ({ requireUser: vi.fn() }));
vi.mock("@/lib/current-user", () => ({ requireUser: currentUser.requireUser }));

// Import after the mock so the loop (via requireRuntimeAccess -> requireWorkspacePermission -> requireUser) resolves to the mocked user.
const { runCollaborationTurn, resumeAfterApproval } = await import("@/lib/orchestration/orchestrator");

afterAll(async () => db.$disconnect());
beforeEach(() => currentUser.requireUser.mockReset());

type Responder = (prompt: string, call: number) => string;

/** A scripted "LLM" whose response can depend on the prompt it was just
 *  given (needed to react to real, DB-generated task ids echoed back in
 *  tool results — a static reply list can't know those ahead of time). */
function scriptedAdapter(kind: AgentRuntimeKind, respond: Responder): AgentRuntimeAdapter {
  let call = 0;
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
          runtime: kind, runtimeInstanceId: input.runtimeId, agentId: runtime.agentId,
          userId: input.userId, workspaceId: input.workspaceId, workingDirectory: input.workingDirectory, status: "ready",
        },
      });
      return toAgentSession(row);
    },
    async resumeSession() {
      throw new Error("not used in these tests");
    },
    async *send(input: SendTaskInput): AsyncIterable<RuntimeEvent> {
      yield { type: "assistant_delta", sessionId: input.sessionId, sequence: 1, timestamp: new Date().toISOString(), data: { text: respond(input.prompt, call++) } };
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

function staticReplies(replies: string[]): Responder {
  let i = 0;
  return () => replies[Math.min(i++, replies.length - 1)];
}

function jsonBlock(directives: { tool: string; args?: Record<string, unknown> }[]): string {
  return "```json\n" + JSON.stringify(directives.map((d) => ({ tool: d.tool, args: d.args ?? {} }))) + "\n```";
}

/** Extracts real task ids Sentinel echoes into every turn's prompt (either
 *  in the previous turn's tool results, e.g. `"taskId": "cm..."`, or in the
 *  persistent "Current tasks in this room" summary, e.g. `- cm...: "..."`)
 *  so a scripted reply can act on them without knowing DB-generated ids
 *  ahead of time. */
function extractTaskIds(prompt: string): string[] {
  const jsonIds = [...prompt.matchAll(/"taskId":\s*"([^"]+)"/g)].map((m) => m[1]);
  const summaryIds = [...prompt.matchAll(/^- (\S+):/gm)].map((m) => m[1]);
  return Array.from(new Set([...jsonIds, ...summaryIds]));
}

async function setUpRoom() {
  const user = await makeUser();
  const workspace = await makeWorkspace(user.id, "Lisa loop test workspace");
  await db.agentRuntime.update({ where: { id: "runtime-hermes-lisa" }, data: { workspaceId: workspace.id } });
  await db.agentRuntime.update({ where: { id: "runtime-claude-code" }, data: { workspaceId: workspace.id } });
  await db.agentRuntime.update({ where: { id: "runtime-codex" }, data: { workspaceId: workspace.id } });
  currentUser.requireUser.mockResolvedValue(user);

  const room = await db.chatRoom.create({
    data: { name: "Lisa loop test room", userId: user.id, agentIds: ["hermes-lisa", "claude-code", "codex"] },
  });
  return { user, workspace, room };
}

describe("Lisa's tool-calling execution loop", () => {
  it("decomposes into tasks, routes them dynamically, dispatches in parallel, and accepts DONE once real completion criteria pass", async () => {
    const { user, room } = await setUpRoom();
    setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", staticReplies(["Implemented the backend service."])));
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", staticReplies(["Wrote the test coverage."])));
    setRuntimeAdapterForTests("hermes", scriptedAdapter("hermes", (prompt, call) => {
      if (call === 0) {
        return jsonBlock([
          { tool: "createTask", args: { title: "Build backend service", capabilities: ["backend", "architecture"], fileScope: ["src/lib/orchestration/**"] } },
          { tool: "createTask", args: { title: "Write test coverage", capabilities: ["testing", "debugging"], fileScope: ["tests/orchestration/**"] } },
        ]);
      }
      if (call === 1) {
        const ids = extractTaskIds(prompt);
        return jsonBlock(ids.map((taskId) => ({ tool: "startTask", args: { taskId } })));
      }
      return jsonBlock([{ tool: "DONE", args: { summary: "Both tasks implemented." } }]);
    }));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Build collaborative agent execution" });

    const tasks = await db.task.findMany({ where: { chatRoomId: room.id }, orderBy: { createdAt: "asc" } });
    expect(tasks).toHaveLength(2);
    expect(tasks.every((t) => t.status === "COMPLETED")).toBe(true);
    expect(tasks.find((t) => t.title === "Build backend service")?.agentId).toBe("claude-code");
    expect(tasks.find((t) => t.title === "Write test coverage")?.agentId).toBe("codex");

    const claimEvents = await db.collaborationEvent.findMany({ where: { chatRoomId: room.id, type: "task.claimed" } });
    const claimedAgentIds = new Set(claimEvents.map((e) => (e.payload as { agentId?: string }).agentId));
    expect(claimedAgentIds).toEqual(new Set(["claude-code", "codex"])); // dynamic routing, not a fixed split

    const completedEvent = await db.collaborationEvent.findFirst({ where: { chatRoomId: room.id, type: "objective.completed" } });
    expect(completedEvent).not.toBeNull();
    const locks = await db.executionLock.findMany({ where: { chatRoomId: room.id, releasedAt: null } });
    expect(locks).toHaveLength(0); // released once each task's turn finished
  });

  it("rejects a premature DONE claim when a task hasn't actually finished, forcing Lisa to keep going", async () => {
    const { user, room } = await setUpRoom();
    setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", staticReplies(["Implemented it."])));
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", staticReplies(["n/a"])));
    setRuntimeAdapterForTests("hermes", scriptedAdapter("hermes", (prompt, call) => {
      if (call === 0) return jsonBlock([{ tool: "createTask", args: { title: "Solo task", capabilities: ["backend"] } }]);
      if (call === 1) {
        // Claims done WITHOUT ever starting the task — Sentinel must catch this.
        return jsonBlock([{ tool: "DONE", args: { summary: "Done!" } }]);
      }
      if (call === 2) {
        const [taskId] = extractTaskIds(prompt);
        return jsonBlock([{ tool: "startTask", args: { taskId } }]);
      }
      return jsonBlock([{ tool: "DONE", args: { summary: "Actually done now." } }]);
    }));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Do one thing" });

    const task = await db.task.findFirstOrThrow({ where: { chatRoomId: room.id } });
    expect(task.status).toBe("COMPLETED");
    const completedEvents = await db.collaborationEvent.count({ where: { chatRoomId: room.id, type: "objective.completed" } });
    expect(completedEvents).toBe(1); // only the second, real DONE was accepted
  });

  it("surfaces a file-scope conflict from assignTask instead of silently resolving it, and Lisa can route around it", async () => {
    const { user, room } = await setUpRoom();
    await acquireExecutionLock({ chatRoomId: room.id, agentId: "codex", resourcePattern: "src/lib/orchestration/**" });
    setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", staticReplies(["Implemented it."])));
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", staticReplies(["n/a"])));
    setRuntimeAdapterForTests("hermes", scriptedAdapter("hermes", (prompt, call) => {
      if (call === 0) return jsonBlock([{ tool: "createTask", args: { title: "Orchestration tweak", fileScope: ["src/lib/orchestration/orchestrator.ts"] } }]);
      if (call === 1) {
        const [taskId] = extractTaskIds(prompt);
        return jsonBlock([{ tool: "assignTask", args: { taskId, agentId: "claude-code" } }]); // conflicts with codex's held lock
      }
      if (call === 2) {
        const [taskId] = extractTaskIds(prompt);
        return jsonBlock([{ tool: "startTask", args: { taskId } }]); // no explicit owner -> auto-routes, avoiding the conflict
      }
      return jsonBlock([{ tool: "DONE", args: { summary: "Rerouted around the conflict." } }]);
    }));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Tweak orchestration" });

    const task = await db.task.findFirstOrThrow({ where: { chatRoomId: room.id } });
    // assignTask to claude-code was rejected as a conflict (never applied);
    // the later startTask auto-routed around it straight to codex, which
    // already held the matching lock.
    expect(task.status).toBe("COMPLETED");
    expect(task.agentId).toBe("codex");
    const claimEvents = await db.collaborationEvent.findMany({ where: { chatRoomId: room.id, type: "task.claimed", payload: { path: ["agentId"], equals: "claude-code" } } });
    expect(claimEvents).toHaveLength(0);
  });

  it("loops changes-requested through requestReview up to the budget, then refuses another round", async () => {
    const { user, room } = await setUpRoom();
    setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", staticReplies(["Refactored the router."])));
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", staticReplies([
      "VERDICT: CHANGES_REQUESTED\nMissing a test.",
      "VERDICT: CHANGES_REQUESTED\nStill missing a test.",
      "VERDICT: CHANGES_REQUESTED\nStill not addressed.",
    ])));
    setRuntimeAdapterForTests("hermes", scriptedAdapter("hermes", (prompt, call) => {
      if (call === 0) return jsonBlock([{ tool: "createTask", args: { title: "Refactor the task router", capabilities: ["refactoring", "architecture"], fileScope: ["prisma/schema.prisma"] } }]);
      const ids = extractTaskIds(prompt);
      const taskId = ids[0];
      if (call === 1) return jsonBlock([{ tool: "startTask", args: { taskId } }]);
      if (call >= 2 && call <= 4) return jsonBlock([{ tool: "requestReview", args: { taskId } }]);
      // Budget exhausted by now (3 CHANGES_REQUESTED rounds) — try a 4th and expect a refusal, then ask the user.
      if (call === 5) return jsonBlock([{ tool: "requestReview", args: { taskId } }]);
      return jsonBlock([{ tool: "ASK_USER", args: { question: "Review budget is exhausted on this task — how should I proceed?" } }]);
    }));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Refactor the task router" });

    const task = await db.task.findFirstOrThrow({ where: { chatRoomId: room.id } });
    expect(task.status).toBe("CHANGES_REQUESTED");
    const question = await db.message.findFirstOrThrow({ where: { chatRoomId: room.id, messageType: "QUESTION" } });
    expect(question.content).toContain("Review budget");
  });

  it("gates a high-risk task behind human approval and resumes the loop once approved", async () => {
    const { user, room } = await setUpRoom();
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", staticReplies(["Migration executed."])));
    // claude-code is the cross-reviewer here (codex owns it) — high-risk
    // tasks always get reviewed, they never auto-complete.
    setRuntimeAdapterForTests("claude-code", scriptedAdapter("claude-code", staticReplies(["VERDICT: APPROVE\nSafe to ship."])));
    // resumeAfterApproval starts a fresh runLisaLoop invocation, so this
    // responder reacts to the task's actual current status in the prompt
    // rather than a raw turn-index script (which wouldn't survive the
    // scripted adapter's call counter continuing across two invocations).
    setRuntimeAdapterForTests("hermes", scriptedAdapter("hermes", (prompt) => {
      const [taskId] = extractTaskIds(prompt);
      if (!taskId) return jsonBlock([{ tool: "createTask", args: { title: "Run prisma migrate deploy against production", capabilities: ["devops"] } }]);
      if (prompt.includes("status=COMPLETED")) return jsonBlock([{ tool: "DONE", args: { summary: "Migration complete." } }]);
      if (prompt.includes("status=WAITING_REVIEW")) return jsonBlock([{ tool: "requestReview", args: { taskId } }]);
      // The resume seed says the human just approved it — retry startTask
      // (its internal approval check will now find it cleared) rather than
      // asking again just because the DB status label hasn't flipped yet.
      if (prompt.includes("was just approved")) return jsonBlock([{ tool: "startTask", args: { taskId } }]);
      // First time seeing it gated, with no such resume context: ask the user.
      if (prompt.includes("status=APPROVAL_REQUIRED")) return jsonBlock([{ tool: "ASK_USER", args: { question: "This migration needs your approval before I can continue." } }]);
      return jsonBlock([{ tool: "startTask", args: { taskId } }]);
    }));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "Run prisma migrate deploy against production" });

    let task = await db.task.findFirstOrThrow({ where: { chatRoomId: room.id } });
    expect(task.status).toBe("APPROVAL_REQUIRED");
    expect(task.agentId).toBe("codex"); // devops weight favors codex
    const approval = await db.approvalRequest.findFirstOrThrow({ where: { taskId: task.id } });
    await db.approvalRequest.update({ where: { id: approval.id }, data: { status: "approved" } });

    await resumeAfterApproval(task.id);

    task = await db.task.findUniqueOrThrow({ where: { id: task.id } });
    expect(task.status).toBe("COMPLETED");
    expect(task.reviewerAgentId).toBe("claude-code"); // high risk always gets a cross-review too
  });

  it("routes a single @mention to a direct reply instead of entering the tool-calling loop", async () => {
    const { user, room } = await setUpRoom();
    setRuntimeAdapterForTests("codex", scriptedAdapter("codex", staticReplies(["Reviewed the locking approach — it's sound."])));

    await runCollaborationTurn({ chatRoomId: room.id, userId: user.id, userContent: "@codex what do you think of the locking approach?", recipientAgentIds: ["codex"] });

    expect(await db.task.count({ where: { chatRoomId: room.id } })).toBe(0);
    const reply = await db.message.findFirstOrThrow({ where: { chatRoomId: room.id, messageType: "ANSWER" } });
    expect(reply.agentId).toBe("codex");
    expect(reply.content).toContain("locking approach");
  });
});
