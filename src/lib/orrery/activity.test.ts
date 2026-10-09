import { beforeEach, describe, expect, it, vi } from "vitest";

const db = vi.hoisted(() => ({
  agentSession: { findMany: vi.fn() },
  agentRuntimeEvent: { findMany: vi.fn() },
  orchestrationRun: { findMany: vi.fn() },
  experience: { findMany: vi.fn() },
  approvalRequest: { findMany: vi.fn() },
  agent: { findMany: vi.fn() },
  knowledgeObject: { findMany: vi.fn() },
}));
const permission = vi.hoisted(() => vi.fn());

vi.mock("@/lib/db", () => ({ db }));
vi.mock("@/lib/agents/permissions", () => ({ getAccessibleWorkspaceIds: vi.fn(async () => ["ws-1"]) }));
vi.mock("@/lib/workspaces/authorization", () => ({ userHasWorkspacePermission: permission }));

import { CURSOR_OVERLAP_MS, getOrreryActivity } from "./activity";

const NOW = new Date();
const minutesAgo = (m: number) => new Date(NOW.getTime() - m * 60_000);

beforeEach(() => {
  vi.clearAllMocks();
  db.agentSession.findMany.mockResolvedValue([]);
  db.agentRuntimeEvent.findMany.mockResolvedValue([]);
  db.orchestrationRun.findMany.mockResolvedValue([]);
  db.experience.findMany.mockResolvedValue([]);
  db.approvalRequest.findMany.mockResolvedValue([]);
  db.agent.findMany.mockResolvedValue([{ id: "hermes-lisa" }, { id: "codex" }]);
  db.knowledgeObject.findMany.mockResolvedValue([]);
  permission.mockResolvedValue(true);
});

describe("getOrreryActivity", () => {
  it("reports nothing invented when there is no activity", async () => {
    const result = await getOrreryActivity("user-1");
    expect(result.events).toEqual([]);
    expect(result.runs).toEqual([]);
    expect(result.approvals).toEqual([]);
    expect(result.agents.map((a) => a.state)).toEqual(["idle", "idle"]);
  });

  it("marks an agent working only while it has a fresh active session", async () => {
    db.agentSession.findMany.mockResolvedValue([
      { id: "s1", agentId: "codex", status: "running", startedAt: minutesAgo(3), lastActivityAt: minutesAgo(1), chatRoomId: null, metadata: { title: "Review PR21" } },
      { id: "s2", agentId: "hermes-lisa", status: "running", startedAt: minutesAgo(90), lastActivityAt: minutesAgo(60), chatRoomId: null, metadata: {} },
    ]);
    const result = await getOrreryActivity("user-1");
    expect(result.agents.find((a) => a.agentId === "codex")?.state).toBe("working");
    expect(result.agents.find((a) => a.agentId === "hermes-lisa")?.state).toBe("idle");
    expect(result.runs).toHaveLength(1);
    expect(result.runs[0]).toMatchObject({ kind: "session", agentId: "codex", title: "Review PR21" });
  });

  it("turns runtime events into node-linked events through the chat-room bridge", async () => {
    db.agentSession.findMany.mockResolvedValue([
      { id: "s1", agentId: "codex", status: "running", startedAt: minutesAgo(2), lastActivityAt: minutesAgo(0), chatRoomId: "room-9", metadata: {} },
    ]);
    db.agentRuntimeEvent.findMany.mockResolvedValue([
      { id: "ev1", type: "command_started", occurredAt: minutesAgo(1), payload: { data: { event: { item: { command: "vitest run" } } } }, session: { id: "s1", agentId: "codex", chatRoomId: "room-9" } },
    ]);
    db.knowledgeObject.findMany.mockResolvedValue([{ id: "node-room-9", sourceType: "chat_room", sourceId: "room-9" }]);
    const result = await getOrreryActivity("user-1");
    expect(result.events).toEqual([
      expect.objectContaining({ id: "rt:ev1", agentId: "codex", verb: "exec", text: "vitest run", nodeIds: ["node-room-9"] }),
    ]);
  });

  it("links experience recall to the knowledge objects it actually used", async () => {
    db.experience.findMany.mockResolvedValue([
      { id: "x1", agentId: "hermes-lisa", objective: "Recall OAuth decisions", knowledgeUsed: ["k1", "k2"], startedAt: minutesAgo(1), completedAt: null },
    ]);
    const result = await getOrreryActivity("user-1");
    expect(result.events[0]).toMatchObject({ verb: "recall", nodeIds: ["k1", "k2"], agentId: "hermes-lisa" });
  });

  it("exposes the agent's own graph node when one is bridged", async () => {
    db.knowledgeObject.findMany.mockResolvedValue([{ id: "node-lisa", sourceType: "agent", sourceId: "hermes-lisa" }]);
    const result = await getOrreryActivity("user-1");
    expect(result.agents.find((a) => a.agentId === "hermes-lisa")?.nodeId).toBe("node-lisa");
    expect(result.agents.find((a) => a.agentId === "codex")?.nodeId).toBeNull();
  });

  it("only surfaces approvals the caller may review", async () => {
    db.approvalRequest.findMany.mockResolvedValue([
      { id: "a1", workspaceId: "ws-1", title: "Prod deploy", type: "deploy", risk: "high", requesterAgentId: "codex", description: null, createdAt: minutesAgo(2), taskId: null },
    ]);
    permission.mockResolvedValueOnce(false);
    expect((await getOrreryActivity("user-1")).approvals).toEqual([]);

    permission.mockResolvedValueOnce(true);
    const allowed = await getOrreryActivity("user-1");
    expect(allowed.approvals).toEqual([expect.objectContaining({ id: "a1", risk: "high" })]);
    expect(allowed.events).toEqual([expect.objectContaining({ id: "appr:a1", verb: "wait", agentId: "codex" })]);
  });

  describe("cursor", () => {
    const runtimeEvent = (n: number, at: Date) => ({ id: `ev${n}`, type: "tool_started", occurredAt: at, payload: {}, session: { id: "s1", agentId: "codex", chatRoomId: null } });

    it("lags the clock so a row that commits a moment late is offered again, not lost", async () => {
      const before = Date.now();
      const result = await getOrreryActivity("user-1");
      expect(new Date(result.cursor).getTime()).toBeLessThanOrEqual(Date.now() - CURSOR_OVERLAP_MS);
      expect(new Date(result.cursor).getTime()).toBeGreaterThanOrEqual(before - CURSOR_OVERLAP_MS - 1);
      expect(result.truncated).toBe(false);
    });

    it("reads from the cursor inclusively, so rows stamped at the boundary are re-sent", async () => {
      const since = minutesAgo(1);
      await getOrreryActivity("user-1", since);
      expect(db.agentRuntimeEvent.findMany.mock.calls[0][0].where.occurredAt).toEqual({ gte: since });
    });

    it("pages a busy window: a full page stops the cursor at the last row returned instead of jumping to now", async () => {
      const first = minutesAgo(4);
      const rows = Array.from({ length: 80 }, (_, i) => runtimeEvent(i, new Date(first.getTime() + i * 1000)));
      db.agentRuntimeEvent.findMany.mockResolvedValue(rows);
      const result = await getOrreryActivity("user-1", minutesAgo(5));
      expect(result.truncated).toBe(true);
      expect(result.events).toHaveLength(80);
      expect(result.cursor).toBe(rows[79].occurredAt.toISOString());
    });

    it("pages experiences on the column each is matched by: old-started rows that completed in the window do not break the cursor", async () => {
      const since = minutesAgo(5);
      const longRunning = Array.from({ length: 80 }, (_, i) => ({
        id: `old${i}`, agentId: "codex", objective: `long task ${i}`, knowledgeUsed: [],
        startedAt: minutesAgo(600 + i), completedAt: new Date(since.getTime() + (i + 1) * 1000),
      }));
      db.experience.findMany.mockImplementation(async (args: { where: Record<string, unknown> }) => ("completedAt" in args.where ? longRunning : []));
      const result = await getOrreryActivity("user-1", since);
      expect(result.truncated).toBe(true);
      // The cursor stops at the last COMPLETION returned, so the next poll continues from there rather than skipping the rest.
      expect(result.cursor).toBe(longRunning[79].completedAt.toISOString());
      expect(new Date(result.cursor).getTime()).toBeGreaterThan(since.getTime() + 1);
    });

    it("never repeats a window it cannot page any finer", async () => {
      const at = minutesAgo(2);
      db.agentRuntimeEvent.findMany.mockResolvedValue(Array.from({ length: 80 }, (_, i) => runtimeEvent(i, at)));
      const result = await getOrreryActivity("user-1", at);
      expect(new Date(result.cursor).getTime()).toBe(at.getTime() + 1);
    });
  });
});
