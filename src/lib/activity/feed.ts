import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";

export interface ActivityItem {
  id: string;
  source: "runtime" | "collaboration";
  type: string;
  occurredAt: Date;
  summary: string;
  agentName?: string;
  workspaceId?: string | null;
  chatRoomName?: string | null;
}

// High-volume streaming events (token deltas, raw stdio) are execution
// detail, not activity — the feed is for what happened, not the play-by-play.
const NOISY_RUNTIME_EVENT_TYPES = ["stdout", "stderr", "assistant_delta"];

function jsonRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : {};
}

function jsonString(value: unknown, key: string): string | undefined {
  const raw = jsonRecord(value)[key];
  return typeof raw === "string" ? raw : undefined;
}

function humanize(type: string): string {
  return type.replace(/[._]/g, " ");
}

function describeRuntimeEvent(type: string, agentName: string, payload: unknown): string {
  switch (type) {
    case "session_started": return `${agentName} started a session`;
    case "tool_started": return `${agentName} called ${jsonString(payload, "tool") ?? "a tool"}`;
    case "tool_completed": return `${agentName} finished ${jsonString(payload, "tool") ?? "a tool call"}`;
    case "approval_required": return `${agentName} is waiting on approval`;
    case "file_changed": return `${agentName} changed ${jsonString(payload, "path") ?? "a file"}`;
    case "command_started": return `${agentName} ran ${jsonString(payload, "command") ?? "a command"}`;
    case "command_completed": return `${agentName} finished a command`;
    case "delegated": return `${agentName} delegated to another agent`;
    case "cancelled": return `${agentName}'s session was cancelled`;
    case "error": return `${agentName} hit an error`;
    case "warning": return `${agentName} reported a warning`;
    default: return `${agentName} — ${humanize(type)}`;
  }
}

function describeCollaborationEvent(type: string): string {
  switch (type) {
    case "task.created": return "Task created";
    case "task.claimed": return "Task claimed";
    case "task.started": return "Task started";
    case "task.blocked": return "Task blocked";
    case "task.completed": return "Task completed";
    case "task.review_requested": return "Review requested";
    case "task.review_failed": return "Review failed";
    case "task.approved": return "Task approved";
    case "artifact.created": return "Artifact created";
    case "artifact.modified": return "Artifact updated";
    case "decision.created": return "Decision recorded";
    case "approval.requested": return "Approval requested";
    case "approval.granted": return "Approval granted";
    case "approval.denied": return "Approval denied";
    case "objective.completed": return "Objective completed";
    case "agent.joined": return "Agent joined the room";
    case "agent.started": return "Agent started working";
    case "agent.finished": return "Agent finished working";
    case "agent.failed": return "Agent failed";
    default: return humanize(type);
  }
}

/**
 * Fan-in activity feed: merges the two existing gap-free event logs
 * (AgentRuntimeEvent per session, CollaborationEvent per room) into one
 * chronological view, scoped to what this user can see. Reads only —
 * writes still go through store.ts's append() and event-bus.ts's
 * emitCollaborationEvent() so there is exactly one write path per log.
 */
export async function listActivityForUser(userId: string, workspaceIds: string[], limit = 100): Promise<ActivityItem[]> {
  const [runtimeEvents, collaborationEvents] = await Promise.all([
    db.agentRuntimeEvent.findMany({
      where: {
        type: { notIn: NOISY_RUNTIME_EVENT_TYPES },
        session: {
          OR: [{ userId }, ...(workspaceIds.length ? [{ workspaceId: { in: workspaceIds } }] : [])],
        },
      },
      include: { session: { select: { agentId: true, workspaceId: true } } },
      orderBy: { occurredAt: "desc" },
      take: limit,
    }),
    db.collaborationEvent.findMany({
      where: { chatRoom: { userId } },
      include: { chatRoom: { select: { name: true } } },
      orderBy: { occurredAt: "desc" },
      take: limit,
    }),
  ]);

  const runtimeItems: ActivityItem[] = runtimeEvents.map((event) => {
    const agentName = getVpsAgent(event.session.agentId)?.name ?? event.session.agentId;
    return {
      id: `runtime:${event.id}`,
      source: "runtime",
      type: event.type,
      occurredAt: event.occurredAt,
      summary: describeRuntimeEvent(event.type, agentName, event.payload),
      agentName,
      workspaceId: event.session.workspaceId,
    };
  });

  const collaborationItems: ActivityItem[] = collaborationEvents.map((event) => ({
    id: `collab:${event.id}`,
    source: "collaboration",
    type: event.type,
    occurredAt: event.occurredAt,
    summary: describeCollaborationEvent(event.type),
    chatRoomName: event.chatRoom.name,
  }));

  return [...runtimeItems, ...collaborationItems]
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime())
    .slice(0, limit);
}
