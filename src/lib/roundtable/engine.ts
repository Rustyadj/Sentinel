import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";
import { RUNTIME_AGENT_MAP, runtimeEventText } from "@/lib/agents/runtime/chat-routing";
import { requireRuntimeAccess, RUNTIME_PERMISSIONS } from "@/lib/agents/runtime/authorization";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";
import type { RuntimeView } from "@/lib/agents/runtime/types";
import { ensureTaskWorktree } from "@/lib/orchestration/worktree-manager";
import { openingPrompt, responsePrompt, splitPosition, synthesisPrompt, type TranscriptTurn } from "./prompts";

// Agents discussing a topic with each other. Every turn is a real turn
// through that agent's own runtime: nothing here writes an agent's words for
// it, and a runtime that fails is shown as failed rather than filled in.

export class RoundtableError extends Error {
  constructor(message: string, public readonly status: 400 | 403 | 404 | 409) {
    super(message);
  }
}

export const MIN_AGENTS = 2;
export const MAX_AGENTS = 4;
export const MAX_ROUNDS = 3;
const TURN_TIMEOUT_MS = 4 * 60_000;
const MAX_TURN_CHARS = 6_000;
/** How often a speaking turn's text is written while it streams. */
const FLUSH_MS = 700;
/** A discussion with no turn activity for this long was cut off (a restart, a crashed runner). */
export const STALLED_AFTER_MS = 8 * 60_000;

interface Seat {
  agentId: string;
  name: string;
  runtime: RuntimeView;
}

/**
 * Checks that the caller may run every agent they picked, and resolves each
 * one's runtime while the request (and its session) is still in hand. The
 * discussion itself runs after the response has been sent.
 */
export async function seatAgents(agentIds: string[]): Promise<Seat[]> {
  const unique = [...new Set(agentIds)];
  if (unique.length < MIN_AGENTS || unique.length > MAX_AGENTS) {
    throw new RoundtableError(`A roundtable needs between ${MIN_AGENTS} and ${MAX_AGENTS} agents.`, 400);
  }
  const seats: Seat[] = [];
  for (const agentId of unique) {
    const agent = getVpsAgent(agentId);
    const route = RUNTIME_AGENT_MAP[agentId];
    if (!agent || !route) throw new RoundtableError(`${agentId} is not an agent that can join a roundtable.`, 400);
    const { runtime } = await requireRuntimeAccess(route.runtimeId, RUNTIME_PERMISSIONS.execute);
    seats.push({ agentId, name: agent.name, runtime });
  }
  return seats;
}

async function nextSequence(discussionId: string): Promise<number> {
  const last = await db.discussionTurn.aggregate({ where: { discussionId }, _max: { sequence: true } });
  return (last._max.sequence ?? 0) + 1;
}

/** Adds a turn at the end. Retries on the unique (discussion, sequence) so a person and an agent cannot collide. */
async function appendTurn(discussionId: string, data: { round: number; kind: string; agentId?: string; authorUserId?: string; content?: string; status?: string }) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await db.discussionTurn.create({
        data: {
          discussionId, sequence: await nextSequence(discussionId), round: data.round, kind: data.kind,
          agentId: data.agentId, authorUserId: data.authorUserId, content: data.content ?? "",
          status: data.status ?? "speaking", completedAt: data.status === "done" ? new Date() : undefined,
        },
      });
    } catch (error) {
      if (attempt >= 4 || !(error instanceof Error) || !/Unique constraint/.test(error.message)) throw error;
    }
  }
}

async function transcriptOf(discussionId: string, names: Map<string, string>): Promise<TranscriptTurn[]> {
  const turns = await db.discussionTurn.findMany({
    where: { discussionId, status: "done", content: { not: "" } },
    orderBy: { sequence: "asc" },
  });
  const authorIds = [...new Set(turns.flatMap((t) => (t.authorUserId ? [t.authorUserId] : [])))];
  const authors = authorIds.length ? await db.user.findMany({ where: { id: { in: authorIds } }, select: { id: true, name: true } }) : [];
  const personName = new Map(authors.map((a) => [a.id, a.name ?? "Someone"]));
  return turns.map((turn) => ({
    kind: turn.kind,
    speaker: turn.agentId ? names.get(turn.agentId) ?? turn.agentId : personName.get(turn.authorUserId ?? "") ?? "Someone",
    content: turn.position ? `${turn.content}\n(Position: ${turn.position})` : turn.content,
  }));
}

class Speaker {
  private sessionId: string | null = null;
  private workingDirectory: string | undefined;
  private prepared = false;

  constructor(private seat: Seat, private discussionId: string, private userId: string) {}

  /**
   * Claude Code and Codex can write. They are asked only to talk, but a
   * request is not a guarantee, so they get the same isolation any direct
   * reply gets: a worktree of their own, never the shared tree.
   */
  private async prepare() {
    if (this.prepared) return;
    const kind = getVpsAgent(this.seat.agentId)?.kind;
    if (kind === "claude-code" || kind === "codex") {
      const worktree = await ensureTaskWorktree({
        runtime: asRuntimeInstance(this.seat.runtime), taskId: `roundtable-${this.discussionId}`, agentId: this.seat.agentId,
      });
      this.workingDirectory = worktree.path;
    }
    this.prepared = true;
  }

  async speak(prompt: string, onText: (soFar: string) => void, live: () => Promise<boolean>): Promise<string> {
    if (!(await live())) throw new Error("Discussion stopped");
    await this.prepare();
    const adapter = getRuntimeAdapter(this.seat.runtime.kind);
    const readiness = await adapter.readiness(asRuntimeInstance(this.seat.runtime));
    if (!readiness.ready) throw new Error(`${this.seat.name} is not reachable: ${readiness.reason ?? "runtime not ready"}`);

    // One session per speaker for the whole discussion, so a reply in round
    // two comes from the same conversation that gave the opening.
    if (!this.sessionId) {
      const session = await adapter.startSession({
        runtimeId: this.seat.runtime.id, userId: this.userId,
        workspaceId: this.seat.runtime.workspaceId ?? undefined, workingDirectory: this.workingDirectory,
      });
      this.sessionId = session.id;
    }

    if (!(await live())) throw new Error("Discussion stopped");
    let text = "";
    const deadline = Date.now() + TURN_TIMEOUT_MS;
    const stream = adapter.send({ sessionId: this.sessionId, prompt, userId: this.userId })[Symbol.asyncIterator]();
    try {
      for (;;) {
        const remaining = deadline - Date.now();
        if (remaining <= 0) throw new Error(`${this.seat.name} did not finish within ${TURN_TIMEOUT_MS / 60_000} minutes`);
        let timer: ReturnType<typeof setTimeout> | undefined;
        const nextPromise = stream.next();
        let next;
        for (;;) {
          next = await Promise.race([
            nextPromise,
            new Promise<"check">((resolve) => { timer = setTimeout(() => resolve("check"), Math.min(250, remaining)); }),
          ]).finally(() => clearTimeout(timer));
          if (!(await live())) throw new Error("Discussion stopped");
          if (Date.now() >= deadline) throw new Error(`${this.seat.name} did not finish within ${TURN_TIMEOUT_MS / 60_000} minutes`);
          if (next !== "check") break;
        }
        if (next.done) break;
        const event = next.value;
        if (event.type === "error") {
          const reason = typeof event.data.reason === "string" ? event.data.reason : typeof event.data.message === "string" ? event.data.message : "runtime error";
          throw new Error(reason);
        }
        const chunk = runtimeEventText(event);
        if (chunk) { text += chunk; onText(text); }
      }
    } catch (error) {
      // Stop a runtime that is still producing output nobody will read.
      await adapter.cancel(this.sessionId).catch(() => undefined);
      void stream.return?.().catch(() => undefined);
      this.sessionId = null;
      throw error;
    }
    if (!text.trim()) throw new Error(`${this.seat.name} returned nothing`);
    return text;
  }
}

async function isLive(discussionId: string, executionId: string): Promise<boolean> {
  const row = await db.discussion.findUnique({ where: { id: discussionId }, select: { status: true, executionId: true } });
  return row?.status === "running" && row.executionId === executionId;
}

/** One agent's turn, from "speaking" to "done" or "failed". Returns whether it produced anything. */
async function takeTurn(input: { discussionId: string; executionId: string; round: number; kind: string; seat: Seat; speaker: Speaker; prompt: string }): Promise<boolean> {
  if (!(await isLive(input.discussionId, input.executionId))) return false;
  const turn = await appendTurn(input.discussionId, { round: input.round, kind: input.kind, agentId: input.seat.agentId });
  let lastFlush = 0;
  let pending: Promise<unknown> = Promise.resolve();
  try {
    const reply = await input.speaker.speak(input.prompt, (soFar) => {
      const now = Date.now();
      if (now - lastFlush < FLUSH_MS) return;
      lastFlush = now;
      // Words appear on the page as they are produced. Chained so writes land in order.
      pending = pending.then(() =>
        db.discussionTurn.updateMany({ where: { id: turn.id, status: "speaking", discussion: { executionId: input.executionId, status: "running" } }, data: { content: soFar.slice(0, MAX_TURN_CHARS) } }),
      ).catch(() => undefined);
    }, () => isLive(input.discussionId, input.executionId));
    await pending;
    if (!(await isLive(input.discussionId, input.executionId))) throw new Error("Discussion stopped");
    const { content, position } = input.kind === "synthesis" ? { content: reply.trim(), position: null } : splitPosition(reply);
    await db.discussionTurn.updateMany({
      where: { id: turn.id, status: "speaking", discussion: { executionId: input.executionId, status: "running" } },
      data: { content: content.slice(0, MAX_TURN_CHARS), position, status: "done", completedAt: new Date() },
    });
    return true;
  } catch (error) {
    await pending;
    await db.discussionTurn.updateMany({
      where: { id: turn.id, status: "speaking" },
      data: { status: "failed", error: (error instanceof Error ? error.message : "Unknown error").slice(0, 400), completedAt: new Date() },
    });
    return false;
  }
}

/**
 * Runs rounds `fromRound..toRound` and then a closing note. Called without
 * being awaited: Sentinel is a long-running server, so the work continues
 * after the response, and the page follows it by reading the turns.
 */
export async function runDiscussion(input: { discussionId: string; executionId?: string; userId: string; askerName: string; seats: Seat[]; fromRound: number; toRound: number }) {
  const { discussionId, seats } = input;
  const names = new Map(seats.map((seat) => [seat.agentId, seat.name]));
  const speakers = new Map(seats.map((seat) => [seat.agentId, new Speaker(seat, discussionId, input.userId)]));
  const discussion = await db.discussion.findUniqueOrThrow({ where: { id: discussionId }, select: { topic: true, executionId: true } });
  const executionId = input.executionId ?? discussion.executionId;

  try {
    let spoke = 0;
    for (let round = input.fromRound; round <= input.toRound; round++) {
      for (const seat of seats) {
        if (!(await isLive(discussionId, executionId))) return; // cancelled
        const transcript = await transcriptOf(discussionId, names);
        const prompt = round === 1
          ? openingPrompt({ speaker: seat.name, others: seats.filter((s) => s !== seat).map((s) => s.name), asker: input.askerName, topic: discussion.topic, earlier: transcript })
          : responsePrompt({ speaker: seat.name, topic: discussion.topic, transcript, round });
        const ok = await takeTurn({ discussionId, executionId, round, kind: round === 1 ? "opening" : "response", seat, speaker: speakers.get(seat.agentId)!, prompt });
        if (ok) spoke++;
      }
      // Nobody could speak at all: stop here instead of running empty rounds.
      if (spoke === 0) throw new Error("None of the agents could be reached.");
    }

    if (!(await isLive(discussionId, executionId))) return;
    if (spoke >= 2) {
      const closer = seats[0];
      const transcript = await transcriptOf(discussionId, names);
      await takeTurn({
        discussionId, executionId, round: input.toRound, kind: "synthesis", seat: closer, speaker: speakers.get(closer.agentId)!,
        prompt: synthesisPrompt({ speaker: closer.name, asker: input.askerName, topic: discussion.topic, transcript }),
      });
    }
    await db.discussion.updateMany({ where: { id: discussionId, executionId, status: "running" }, data: { status: "completed", completedAt: new Date() } });
  } catch (error) {
    await db.discussion.updateMany({
      where: { id: discussionId, executionId, status: "running" },
      data: { status: "failed", error: (error instanceof Error ? error.message : "Unknown error").slice(0, 400), completedAt: new Date() },
    }).catch(() => undefined);
  }
}

export async function startDiscussion(input: { topic: string; title?: string; agentIds: string[]; rounds?: number; projectId?: string | null }, user: { id: string; name: string | null }) {
  const topic = input.topic.trim();
  if (topic.length < 8) throw new RoundtableError("Give the agents a real question to discuss.", 400);
  if (topic.length > 2_000) throw new RoundtableError("Keep the topic under 2,000 characters.", 400);
  const rounds = Math.min(Math.max(Math.round(input.rounds ?? 2), 1), MAX_ROUNDS);
  const seats = await seatAgents(input.agentIds);

  // Each turn is real compute on a real runtime. One discussion at a time per person.
  const running = await db.discussion.findFirst({ where: { createdById: user.id, status: "running" }, select: { id: true } });
  if (running && !(await failIfStalled(running.id))) {
    throw new RoundtableError("You already have a roundtable in progress. Let it finish, or stop it first.", 409);
  }

  const discussion = await db.discussion.create({
    data: {
      title: (input.title?.trim() || topic).slice(0, 120), topic, projectId: input.projectId ?? null,
      createdById: user.id, agentIds: seats.map((seat) => seat.agentId), rounds,
    },
  });
  void runDiscussion({ discussionId: discussion.id, executionId: discussion.executionId, userId: user.id, askerName: user.name ?? "The operator", seats, fromRound: 1, toRound: rounds });
  return discussion;
}

/** Another round on a finished discussion, usually after a person has added something. */
export async function continueDiscussion(discussionId: string, user: { id: string; name: string | null }) {
  const discussion = await db.discussion.findUniqueOrThrow({ where: { id: discussionId } });
  if (discussion.status === "running") throw new RoundtableError("This roundtable is still going.", 409);
  const seats = await seatAgents(discussion.agentIds);
  const last = await db.discussionTurn.aggregate({ where: { discussionId }, _max: { round: true } });
  const round = (last._max.round ?? 0) + 1;
  if (round > MAX_ROUNDS + 3) throw new RoundtableError("This roundtable has run long enough. Start a new one from where it ended.", 409);

  const executionId = randomUUID();
  const claimed = await db.discussion.updateMany({
    where: { id: discussionId, status: { not: "running" } },
    data: { status: "running", executionId, error: null, completedAt: null },
  });
  if (claimed.count !== 1) throw new RoundtableError("This roundtable is still going.", 409);
  // A continuation is always a response round, even if the first attempt never got past openings.
  void runDiscussion({ discussionId, executionId, userId: user.id, askerName: user.name ?? "The operator", seats, fromRound: Math.max(round, 2), toRound: Math.max(round, 2) });
}

export async function cancelDiscussion(discussionId: string) {
  const stopped = await db.discussion.findUnique({ where: { id: discussionId }, select: { executionId: true } });
  if (!stopped) return;
  await db.$transaction(async (tx) => {
    await tx.discussion.updateMany({ where: { id: discussionId, executionId: stopped.executionId, status: "running" }, data: { status: "cancelled", completedAt: new Date() } });
    await tx.discussionTurn.updateMany({
      where: { discussionId, status: "speaking", discussion: { executionId: stopped.executionId, status: "cancelled" } },
      data: { status: "failed", error: "Stopped before finishing", completedAt: new Date() },
    });
  });
}

/** A person says something in the discussion. Agents answer it on their next turn. */
export async function interject(discussionId: string, userId: string, content: string) {
  const text = content.trim();
  if (!text) throw new RoundtableError("Say something first.", 400);
  if (text.length > 2_000) throw new RoundtableError("Keep it under 2,000 characters.", 400);
  const last = await db.discussionTurn.aggregate({ where: { discussionId }, _max: { round: true } });
  return appendTurn(discussionId, { round: last._max.round ?? 1, kind: "human", authorUserId: userId, content: text, status: "done" });
}

/**
 * A discussion marked running whose turns stopped long ago was cut off by a
 * restart. Says so, instead of showing "in progress" forever. Returns true if
 * it was marked.
 */
export async function failIfStalled(discussionId: string): Promise<boolean> {
  const discussion = await db.discussion.findUnique({ where: { id: discussionId }, select: { status: true, createdAt: true } });
  if (discussion?.status !== "running") return false;
  const latest = await db.discussionTurn.findFirst({ where: { discussionId }, orderBy: { sequence: "desc" }, select: { startedAt: true, completedAt: true } });
  const lastActivity = latest?.completedAt ?? latest?.startedAt ?? discussion.createdAt;
  if (Date.now() - lastActivity.getTime() < STALLED_AFTER_MS) return false;
  await db.discussion.updateMany({
    where: { id: discussionId, status: "running" },
    data: { status: "failed", error: "Interrupted before it finished. Start another round to pick it up.", completedAt: new Date() },
  });
  await db.discussionTurn.updateMany({
    where: { discussionId, status: "speaking" },
    data: { status: "failed", error: "Interrupted", completedAt: new Date() },
  });
  return true;
}
