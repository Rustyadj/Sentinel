import { db } from "@/lib/db";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { userHasWorkspacePermission } from "@/lib/workspaces/authorization";
import type { OrreryActivity, OrreryEvent, OrreryRun, OrreryVerb } from "./types";

const ACTIVE_SESSION = ["created", "ready", "running"];
const ACTIVE_RUN = ["queued", "running", "waiting"];
const STALE_ACTIVITY_MS = 10 * 60_000;
const DEFAULT_WINDOW_MS = 15 * 60_000;
const MAX_ROWS = 80;
/** Rows can become visible a moment after the time they carry; re-offer this much history on every poll. */
export const CURSOR_OVERLAP_MS = 5_000;
const MAX_TEXT = 140;
const EXPERIENCE_SELECT = { id: true, agentId: true, objective: true, knowledgeUsed: true, startedAt: true, completedAt: true } as const;

const clip = (value: string) => {
  const flat = value.replace(/\s+/g, " ").trim();
  return flat.length > MAX_TEXT ? `${flat.slice(0, MAX_TEXT - 1)}…` : flat;
};
const asRecord = (value: unknown): Record<string, unknown> =>
  value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
const firstString = (...values: unknown[]) => values.find((v): v is string => typeof v === "string" && v.trim().length > 0);

/** Runtime event types that mean an agent is doing something visible. Streaming
 * text and raw stdout are deliberately excluded — they are not discrete acts. */
const RUNTIME_VERB: Record<string, OrreryVerb> = {
  tool_started: "exec",
  command_started: "exec",
  file_changed: "write",
  approval_required: "wait",
};

function describeRuntimeEvent(type: string, payload: unknown): string {
  const data = asRecord(asRecord(payload).data);
  const event = asRecord(data.event);
  const item = asRecord(event.item);
  const input = asRecord(event.input);
  return clip(
    firstString(item.command, input.command, event.name, input.file_path, item.path, event.command, data.text) ?? type.replace(/_/g, " "),
  );
}

/**
 * Everything the globe needs to show what agents are really doing, scoped to
 * the signed-in user. Reads sessions, runtime events, orchestration runs,
 * experiences and approvals; resolves rows to graph nodes through the
 * KnowledgeObject (sourceType, sourceId) bridge.
 */
export async function getOrreryActivity(userId: string, since?: Date): Promise<OrreryActivity> {
  const now = new Date();
  const from = since ?? new Date(now.getTime() - DEFAULT_WINDOW_MS);
  const workspaceIds = await getAccessibleWorkspaceIds(userId);

  const [sessions, runtimeEvents, runs, startedExperiences, completedExperiences, approvalRows, agents] = await Promise.all([
    db.agentSession.findMany({
      where: { userId, OR: [{ status: { in: ACTIVE_SESSION } }, { lastActivityAt: { gte: from } }] },
      orderBy: { lastActivityAt: "desc" },
      take: MAX_ROWS,
      select: { id: true, agentId: true, status: true, startedAt: true, lastActivityAt: true, chatRoomId: true, metadata: true },
    }),
    db.agentRuntimeEvent.findMany({
      where: { occurredAt: { gte: from }, type: { in: Object.keys(RUNTIME_VERB) }, session: { userId } },
      orderBy: { occurredAt: "asc" },
      take: MAX_ROWS,
      select: { id: true, type: true, payload: true, occurredAt: true, session: { select: { id: true, agentId: true, chatRoomId: true } } },
    }),
    db.orchestrationRun.findMany({
      where: { userId, OR: [{ status: { in: ACTIVE_RUN } }, { updatedAt: { gte: from } }] },
      orderBy: { updatedAt: "desc" },
      take: MAX_ROWS,
      select: { id: true, status: true, resolvedAgentId: true, request: true, retrievedObjectIds: true, startedAt: true, completedAt: true, queuedAt: true, error: true, updatedAt: true },
    }),
    // Two reads, each paged on the column it filters by. One read ordered by startedAt but matched on either column
    // returned old-started rows first and made the cursor (the last startedAt) meaningless for the completed ones.
    workspaceIds.length ? db.experience.findMany({ where: { workspaceId: { in: workspaceIds }, startedAt: { gte: from } }, orderBy: { startedAt: "asc" }, take: MAX_ROWS, select: EXPERIENCE_SELECT }) : Promise.resolve([]),
    workspaceIds.length ? db.experience.findMany({ where: { workspaceId: { in: workspaceIds }, completedAt: { gte: from } }, orderBy: { completedAt: "asc" }, take: MAX_ROWS, select: EXPERIENCE_SELECT }) : Promise.resolve([]),
    workspaceIds.length
      ? db.approvalRequest.findMany({
          where: { workspaceId: { in: workspaceIds }, status: "pending" },
          orderBy: { createdAt: "desc" },
          take: 20,
          select: { id: true, workspaceId: true, title: true, type: true, risk: true, requesterAgentId: true, description: true, createdAt: true, taskId: true },
        })
      : Promise.resolve([]),
    db.agent.findMany({ where: { OR: [{ workspaceId: { in: workspaceIds } }, { workspaceId: null }] }, select: { id: true } }),
  ]);

  // Only approvals the caller may actually review are surfaced.
  const reviewable: Array<(typeof approvalRows)[number]> = [];
  const permitted = new Map<string, boolean>();
  for (const approval of approvalRows) {
    if (!permitted.has(approval.workspaceId)) {
      permitted.set(approval.workspaceId, await userHasWorkspacePermission(userId, approval.workspaceId, "approval.review"));
    }
    if (permitted.get(approval.workspaceId)) reviewable.push(approval);
  }

  // Resolve bridge rows → graph node ids in one query.
  const pairs: Array<{ sourceType: string; sourceId: string }> = [];
  for (const { id } of agents) pairs.push({ sourceType: "agent", sourceId: id });
  for (const s of sessions) if (s.chatRoomId) pairs.push({ sourceType: "chat_room", sourceId: s.chatRoomId });
  for (const a of reviewable) if (a.taskId) pairs.push({ sourceType: "task", sourceId: a.taskId });
  const bridged = pairs.length
    ? await db.knowledgeObject.findMany({
        where: { OR: pairs.map((p) => ({ sourceType: p.sourceType, sourceId: p.sourceId })) },
        select: { id: true, sourceType: true, sourceId: true },
      })
    : [];
  const nodeFor = new Map(bridged.map((o) => [`${o.sourceType}:${o.sourceId}`, o.id]));
  const roomNode = (roomId: string | null) => (roomId ? nodeFor.get(`chat_room:${roomId}`) : undefined);

  const events: OrreryEvent[] = [];
  for (const e of runtimeEvents) {
    const node = roomNode(e.session.chatRoomId);
    events.push({
      id: `rt:${e.id}`, at: e.occurredAt.toISOString(), agentId: e.session.agentId,
      verb: RUNTIME_VERB[e.type] ?? "exec", text: describeRuntimeEvent(e.type, e.payload), nodeIds: node ? [node] : [],
    });
  }
  for (const r of runs) {
    if (!r.resolvedAgentId) continue;
    const request = asRecord(r.request);
    const title = clip(firstString(request.objective, request.task, request.prompt, request.title, request.message) ?? "Orchestration run");
    if (r.startedAt && r.startedAt >= from) {
      events.push({ id: `run:${r.id}:start`, at: r.startedAt.toISOString(), agentId: r.resolvedAgentId, verb: "start", text: title, nodeIds: r.retrievedObjectIds.slice(0, 6) });
    }
    if (r.completedAt && r.completedAt >= from) {
      const failed = r.status === "failed" || r.status === "error";
      events.push({ id: `run:${r.id}:end`, at: r.completedAt.toISOString(), agentId: r.resolvedAgentId, verb: failed ? "fail" : "done", text: failed && r.error ? clip(r.error) : title, nodeIds: [] });
    }
  }
  const experiences = [...new Map([...startedExperiences, ...completedExperiences].map((x) => [x.id, x])).values()];
  for (const x of experiences) {
    if (x.startedAt >= from) {
      events.push({ id: `exp:${x.id}:start`, at: x.startedAt.toISOString(), agentId: x.agentId, verb: x.knowledgeUsed.length ? "recall" : "start", text: clip(x.objective), nodeIds: x.knowledgeUsed.slice(0, 6) });
    }
    if (x.completedAt && x.completedAt >= from) {
      events.push({ id: `exp:${x.id}:end`, at: x.completedAt.toISOString(), agentId: x.agentId, verb: "done", text: clip(x.objective), nodeIds: [] });
    }
  }
  for (const a of reviewable) {
    if (a.requesterAgentId && a.createdAt >= from) {
      const node = a.taskId ? nodeFor.get(`task:${a.taskId}`) : undefined;
      events.push({ id: `appr:${a.id}`, at: a.createdAt.toISOString(), agentId: a.requesterAgentId, verb: "wait", text: clip(`Approval needed · ${a.title}`), nodeIds: node ? [node] : [] });
    }
  }
  events.sort((a, b) => a.at.localeCompare(b.at));

  const working = new Set<string>();
  for (const s of sessions) {
    if (ACTIVE_SESSION.includes(s.status) && now.getTime() - s.lastActivityAt.getTime() < STALE_ACTIVITY_MS) working.add(s.agentId);
  }
  for (const r of runs) if (r.resolvedAgentId && r.status === "running") working.add(r.resolvedAgentId);

  const recentByAgent = new Map<string, OrreryRun["recent"]>();
  for (const e of [...events].reverse()) {
    const list = recentByAgent.get(e.agentId) ?? [];
    if (list.length < 3) list.push({ at: e.at, verb: e.verb, text: e.text });
    recentByAgent.set(e.agentId, list);
  }

  const runCards: OrreryRun[] = [
    ...sessions
      .filter((s) => ACTIVE_SESSION.includes(s.status) && now.getTime() - s.lastActivityAt.getTime() < STALE_ACTIVITY_MS)
      .map((s): OrreryRun => ({
        id: s.id, kind: "session", sessionId: s.id, agentId: s.agentId, status: s.status, startedAt: s.startedAt.toISOString(),
        title: clip(firstString(asRecord(s.metadata).title, asRecord(s.metadata).task, asRecord(s.metadata).objective) ?? "Agent session"),
        recent: recentByAgent.get(s.agentId) ?? [],
      })),
    ...runs
      .filter((r) => ACTIVE_RUN.includes(r.status) && r.resolvedAgentId)
      .map((r): OrreryRun => {
        const request = asRecord(r.request);
        return {
          id: r.id, kind: "run", agentId: r.resolvedAgentId!, status: r.status, startedAt: (r.startedAt ?? r.queuedAt).toISOString(),
          title: clip(firstString(request.objective, request.task, request.prompt, request.title, request.message) ?? "Orchestration run"),
          recent: recentByAgent.get(r.resolvedAgentId!) ?? [],
        };
      }),
  ].slice(0, 6);

  // Where the next poll resumes. Normally just behind the clock; when a capped,
  // oldest-first source returned a full page, only as far as that page reached, so
  // the remainder is delivered next time instead of being skipped.
  let cursorAt = now.getTime() - CURSOR_OVERLAP_MS;
  const capped: Date[] = [];
  if (runtimeEvents.length >= MAX_ROWS) capped.push(runtimeEvents[runtimeEvents.length - 1].occurredAt);
  if (startedExperiences.length >= MAX_ROWS) capped.push(startedExperiences[startedExperiences.length - 1].startedAt);
  const lastCompleted = completedExperiences[completedExperiences.length - 1]?.completedAt;
  if (completedExperiences.length >= MAX_ROWS && lastCompleted) capped.push(lastCompleted);
  for (const edge of capped) cursorAt = Math.min(cursorAt, edge.getTime());
  // Never move backwards past where the caller already was. If a full page ends exactly at the
  // caller's cursor the window cannot be paged any finer, so step past it rather than repeat it forever.
  if (since && cursorAt <= since.getTime()) cursorAt = capped.length ? since.getTime() + 1 : Math.max(cursorAt, since.getTime());
  const truncated = capped.length > 0 || runs.length >= MAX_ROWS || sessions.length >= MAX_ROWS;

  return {
    cursor: new Date(cursorAt).toISOString(),
    truncated,
    events,
    agents: agents.map(({ id }) => ({ agentId: id, state: working.has(id) ? "working" : "idle", nodeId: nodeFor.get(`agent:${id}`) ?? null })),
    runs: runCards,
    approvals: reviewable.map((a) => ({
      id: a.id, workspaceId: a.workspaceId, title: a.title, type: a.type, risk: a.risk,
      requesterAgentId: a.requesterAgentId, description: a.description, createdAt: a.createdAt.toISOString(),
    })),
  };
}
