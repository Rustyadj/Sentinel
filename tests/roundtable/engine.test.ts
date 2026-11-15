// @vitest-environment node
import { randomUUID } from "node:crypto";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// The engine against a real database, with the two things it cannot have in
// a test replaced: the signed-in session behind requireRuntimeAccess, and the
// agent runtimes themselves. What each fake agent "says" is recorded with the
// prompt it was given, so the tests can check who heard what.

const heard: Array<{ agent: string; prompt: string }> = [];
const script = vi.hoisted(() => ({
  reply: (agent: string, _prompt?: string): string => `${agent} view.\nPOSITION: ${agent} holds firm`,
  denied: new Set<string>(),
  pause: null as null | (() => Promise<void>),
  cancelled: [] as string[],
}));

vi.mock("@/lib/agents/runtime/authorization", () => ({
  RUNTIME_PERMISSIONS: { execute: "agents.runtime.execute" },
  requireRuntimeAccess: vi.fn(async (runtimeId: string) => {
    if (script.denied.has(runtimeId)) {
      const { WorkspaceAccessError } = await import("@/lib/workspaces/authorization");
      throw new WorkspaceAccessError("Missing permission: agents.runtime.execute", 403);
    }
    return { runtime: { id: runtimeId, agentId: runtimeId.replace("runtime-", ""), kind: "hermes", transport: "http", workspaceId: null } };
  }),
}));
vi.mock("@/lib/agents/runtime/service", () => ({
  getRuntimeAdapter: () => ({
    readiness: async () => ({ ready: true }),
    startSession: async (input: { runtimeId: string }) => ({ id: `session-${input.runtimeId}-${randomUUID()}` }),
    cancel: async (sessionId: string) => { script.cancelled.push(sessionId); return { ok: true }; },
    send: async function* (input: { sessionId: string; prompt: string }) {
      const agent = /session-runtime-(hermes-[a-z0-9]+)/.exec(input.sessionId)![1];
      heard.push({ agent, prompt: input.prompt });
      const reply = script.reply(agent, input.prompt);
      if (reply === "__error__") { yield { type: "error", data: { reason: "runtime exploded" } }; return; }
      if (script.pause) await script.pause();
      // In two chunks, as a runtime streams.
      yield { type: "assistant_delta", data: { text: reply.slice(0, 5) } };
      yield { type: "assistant_delta", data: { text: reply.slice(5) } };
      yield { type: "completed", data: { text: reply } }; // a summary event must not be counted twice
    },
  }),
}));

import { db } from "@/lib/db";
import { requireDiscussionAccess } from "@/lib/roundtable/access";
import { cancelDiscussion, continueDiscussion, failIfStalled, interject, RoundtableError, runDiscussion, seatAgents, startDiscussion, STALLED_AFTER_MS } from "@/lib/roundtable/engine";
import { splitPosition } from "@/lib/roundtable/prompts";

const AGENTS = ["hermes-lisa", "hermes-nathan2"];
let user: { id: string; name: string | null };

async function settle(discussionId: string) {
  for (let i = 0; i < 200; i++) {
    const row = await db.discussion.findUniqueOrThrow({ where: { id: discussionId } });
    if (row.status !== "running") return row;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("discussion did not settle");
}
const turnsOf = (discussionId: string) => db.discussionTurn.findMany({ where: { discussionId }, orderBy: { sequence: "asc" } });

beforeAll(async () => {
  user = await db.user.create({ data: { email: `roundtable-${randomUUID().slice(0, 8)}@people.test`, name: "Rusty" } });
});
beforeEach(() => {
  heard.length = 0;
  script.denied.clear();
  script.pause = null;
  script.cancelled.length = 0;
  script.reply = (agent) => `${agent} view.\nPOSITION: ${agent} holds firm`;
});

describe("a roundtable", () => {
  it("runs every agent each round, then a closing note, and lets each hear the others", async () => {
    const discussion = await startDiscussion({ topic: "Should we ship the redesign this week?", agentIds: AGENTS, rounds: 2 }, user);
    expect((await settle(discussion.id)).status).toBe("completed");

    const turns = await turnsOf(discussion.id);
    expect(turns.map((t) => `${t.round}:${t.kind}:${t.agentId}`)).toEqual([
      "1:opening:hermes-lisa", "1:opening:hermes-nathan2",
      "2:response:hermes-lisa", "2:response:hermes-nathan2",
      "2:synthesis:hermes-lisa",
    ]);
    expect(turns.every((t) => t.status === "done")).toBe(true);
    // The stance is lifted out of the prose, and streamed chunks are not doubled by the summary event.
    expect(turns[0].content).toBe("hermes-lisa view.");
    expect(turns[0].position).toBe("hermes-lisa holds firm");

    // First speaker has nothing to react to; the second is shown the first's words.
    expect(heard[0].prompt).toContain("You are speaking first.");
    expect(heard[1].prompt).toContain("hermes-lisa view.");
    // Round two addresses the others and forbids restating.
    expect(heard[2].prompt).toContain("Where you disagree, say so plainly");
    expect(heard[2].prompt).toContain("hermes-nathan2 view.");
    // Every prompt keeps the agents to talking.
    expect(heard.every((h) => /do not run tools|no tools/i.test(h.prompt))).toBe(true);
  });

  it("shows an agent that failed as failed, and carries on with the rest", async () => {
    script.reply = (agent) => (agent === "hermes-nathan2" ? "__error__" : `${agent} alone.\nPOSITION: solo`);
    const discussion = await startDiscussion({ topic: "What breaks first under load?", agentIds: AGENTS, rounds: 1 }, user);
    expect((await settle(discussion.id)).status).toBe("completed");
    const turns = await turnsOf(discussion.id);
    expect(turns.map((t) => `${t.agentId}:${t.status}`)).toEqual(["hermes-lisa:done", "hermes-nathan2:failed"]);
    expect(turns[1].error).toBe("runtime exploded");
    expect(turns[1].content).toBe(""); // nothing is written on a failed agent's behalf
    // One voice is not a discussion, so there is no closing note pretending there was one.
    expect(turns.some((t) => t.kind === "synthesis")).toBe(false);
  });

  it("fails outright when nobody can be reached", async () => {
    script.reply = () => "__error__";
    const discussion = await startDiscussion({ topic: "Is anyone there at all today?", agentIds: AGENTS, rounds: 2 }, user);
    const settled = await settle(discussion.id);
    expect(settled.status).toBe("failed");
    expect(settled.error).toMatch(/None of the agents/);
    expect(await turnsOf(discussion.id)).toHaveLength(2); // did not grind through round two
  });

  it("puts what a person says in front of the agents on their next turn", async () => {
    const discussion = await db.discussion.create({ data: { title: "t", topic: "Which database should hold the event log?", createdById: user.id, agentIds: AGENTS, rounds: 1 } });
    await interject(discussion.id, user.id, "Remember we only have one VPS.");
    const seats = await seatAgents(AGENTS);
    await runDiscussion({ discussionId: discussion.id, userId: user.id, askerName: "Rusty", seats, fromRound: 1, toRound: 1 });
    expect(heard[0].prompt).toContain("Rusty (a person in the room):\nRemember we only have one VPS.");
  });

  it("stops when cancelled", async () => {
    const discussion = await startDiscussion({ topic: "A question that will be interrupted.", agentIds: AGENTS, rounds: 3 }, user);
    await cancelDiscussion(discussion.id);
    expect((await settle(discussion.id)).status).toBe("cancelled");
    // Give a runner that ignored the cancel time to show itself.
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect((await turnsOf(discussion.id)).length).toBeLessThan(7); // 3 rounds x 2 agents + closing = 7 if it had run on
    expect((await db.discussion.findUniqueOrThrow({ where: { id: discussion.id } })).status).toBe("cancelled");
  });
});

describe("who may run and see one", () => {
  it("refuses to start with an agent the person may not run", async () => {
    script.denied.add("runtime-hermes-nathan2");
    await expect(startDiscussion({ topic: "Can I borrow your agent please?", agentIds: AGENTS }, user)).rejects.toMatchObject({ status: 403 });
    expect(heard).toHaveLength(0);
  });

  it("needs at least two real agents and a real question", async () => {
    await expect(startDiscussion({ topic: "A fine topic to discuss", agentIds: ["hermes-lisa"] }, user)).rejects.toBeInstanceOf(RoundtableError);
    await expect(startDiscussion({ topic: "A fine topic to discuss", agentIds: ["hermes-lisa", "not-an-agent"] }, user)).rejects.toBeInstanceOf(RoundtableError);
    await expect(startDiscussion({ topic: "hi", agentIds: AGENTS }, user)).rejects.toBeInstanceOf(RoundtableError);
  });

  it("allows one at a time per person", async () => {
    const running = await db.discussion.create({ data: { title: "t", topic: "Already going", createdById: user.id, agentIds: AGENTS, status: "running" } });
    await expect(startDiscussion({ topic: "A second one at the same time", agentIds: AGENTS }, user)).rejects.toMatchObject({ status: 409 });
    await db.discussion.update({ where: { id: running.id }, data: { status: "completed" } });
  });

  it("is private to its starter unless it belongs to a shared project", async () => {
    const outsider = await db.user.create({ data: { email: `outsider-${randomUUID().slice(0, 8)}@people.test`, accessScope: "guest" } });
    const mine = await db.discussion.create({ data: { title: "t", topic: "Private thoughts", createdById: user.id, agentIds: AGENTS, status: "completed" } });
    await expect(requireDiscussionAccess(mine.id, outsider.id, "read")).rejects.toMatchObject({ status: 404 });

    const project = await db.project.create({ data: { name: "Shared", userId: user.id, agents: [], tags: [] } });
    const shared = await db.discussion.create({ data: { title: "t", topic: "Project thoughts", createdById: user.id, agentIds: AGENTS, status: "completed", projectId: project.id } });
    await expect(requireDiscussionAccess(shared.id, outsider.id, "read")).rejects.toMatchObject({ status: 404 });
    await db.projectMember.create({ data: { projectId: project.id, userId: outsider.id, role: "viewer" } });
    expect((await requireDiscussionAccess(shared.id, outsider.id, "read")).id).toBe(shared.id);
    await expect(requireDiscussionAccess(shared.id, outsider.id, "write")).rejects.toMatchObject({ status: 404 }); // a viewer cannot speak
  });

  it("says so when a discussion was cut off, instead of showing it running forever", async () => {
    const old = new Date(Date.now() - STALLED_AFTER_MS - 60_000);
    const stuck = await db.discussion.create({ data: { title: "t", topic: "Interrupted by a restart", createdById: user.id, agentIds: AGENTS, status: "running", createdAt: old } });
    await db.discussionTurn.create({ data: { discussionId: stuck.id, sequence: 1, round: 1, kind: "opening", agentId: "hermes-lisa", startedAt: old } });
    expect(await failIfStalled(stuck.id)).toBe(true);
    const after = await db.discussion.findUniqueOrThrow({ where: { id: stuck.id }, include: { turns: true } });
    expect(after.status).toBe("failed");
    expect(after.turns[0].status).toBe("failed");
  });
});

describe("reading a stance out of a reply", () => {
  it("lifts the POSITION line and leaves the prose", () => {
    expect(splitPosition("I think we wait.\n\nPOSITION: Ship next week, not this one.")).toEqual({ content: "I think we wait.", position: "Ship next week, not this one." });
    expect(splitPosition("We wait.\n**POSITION:** Hold.**")).toEqual({ content: "We wait.", position: "Hold." });
  });
  it("leaves a reply without one untouched", () => {
    expect(splitPosition("My position: unclear.\nMore words.")).toEqual({ content: "My position: unclear.\nMore words.", position: null });
  });
});


describe("execution cancellation", () => {
  it("cancels a blocked runtime and fences it off from a continuation", async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    script.pause = () => blocked;
    const discussion = await startDiscussion({ topic: "Stop this slow runtime before continuing", agentIds: AGENTS, rounds: 1 }, user);
    await vi.waitFor(() => expect(heard).toHaveLength(1));
    const first = (await turnsOf(discussion.id))[0];
    await cancelDiscussion(discussion.id);
    script.pause = null;
    await continueDiscussion(discussion.id, user);
    expect((await settle(discussion.id)).status).toBe("completed");
    await vi.waitFor(() => expect(script.cancelled).toHaveLength(1));
    release();
    await new Promise((resolve) => setTimeout(resolve, 100));
    const turns = await turnsOf(discussion.id);
    expect(turns.find((turn) => turn.id === first.id)?.status).toBe("failed");
    expect(turns.filter((turn) => turn.round === 1)).toHaveLength(1);
    expect((await db.discussion.findUniqueOrThrow({ where: { id: discussion.id } })).status).toBe("completed");
  });
});
