import { MOCK_MISSION_CONTROL } from "./mock";
import type {
  AgentOperation,
  AttentionAction,
  ContinueItem,
  HealthItem,
  MissionControlData,
  MissionControlService,
  MissionFeedItem,
} from "./types";

type UnknownRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is UnknownRecord => typeof value === "object" && value !== null;

async function readJson(path: string, signal?: AbortSignal): Promise<unknown> {
  const response = await fetch(path, { signal, headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(`${path} returned ${response.status}`);
  return response.json();
}

function relativeDate(value: unknown): string {
  if (typeof value !== "string") return "Recently";
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp)) return "Recently";
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function arrayOfRecords(value: unknown): UnknownRecord[] {
  return Array.isArray(value) ? value.filter(isRecord) : [];
}

function mergeAgents(value: unknown, fallback: AgentOperation[]): AgentOperation[] {
  const records = arrayOfRecords(value);
  if (records.length === 0) return fallback;
  const byId = new Map(records.map((record) => [String(record.id ?? ""), record]));
  return fallback.map((agent) => {
    const live = byId.get(agent.id);
    if (!live) return agent;
    const rawStatus = String(live.status ?? agent.status);
    const status = ["online", "busy", "idle", "offline", "error"].includes(rawStatus)
      ? (rawStatus as AgentOperation["status"])
      : agent.status;
    return {
      ...agent,
      name: (typeof live.name === "string" ? live.name : agent.name) as AgentOperation["name"],
      model: typeof live.model === "string" ? live.model : agent.model,
      role: typeof live.role === "string" ? live.role : agent.role,
      status,
    };
  });
}

function liveContinueItems(projectsValue: unknown, roomsValue: unknown): ContinueItem[] {
  const projects = arrayOfRecords(projectsValue).slice(0, 3).map((project) => ({
    id: `project-${String(project.id)}`,
    type: "project" as const,
    title: String(project.name ?? "Untitled project"),
    context: `Project · ${String(project.description ?? "Active work")}`,
    lastActivity: relativeDate(project.updatedAt),
    status: String(project.status ?? "Active"),
    href: `/projects/${String(project.id)}`,
  }));
  const rooms = arrayOfRecords(roomsValue).slice(0, 2).map((room) => ({
    id: `room-${String(room.id)}`,
    type: "conversation" as const,
    title: String(room.name ?? "Conversation"),
    context: `Conversation · ${Array.isArray(room.agentIds) ? room.agentIds.length : 0} agents`,
    lastActivity: relativeDate(room.createdAt),
    status: "Ready",
    href: "/chat",
  }));
  return [...projects, ...rooms];
}

function blockedTaskFeed(value: unknown): MissionFeedItem[] {
  return arrayOfRecords(value)
    .filter((task) => ["blocked", "failed"].includes(String(task.status ?? "")))
    .slice(0, 3)
    .map((task) => ({
      id: `task-feed-${String(task.id)}`,
      scope: "projects" as const,
      event: `Task ${String(task.status)}: ${String(task.title ?? "Untitled task")}`,
      actor: String(task.assignee ?? task.agentId ?? "System"),
      source: String(task.projectId ?? "Mission Control"),
      timestamp: relativeDate(task.createdAt),
      tone: "warning" as const,
      href: "/workflows",
    }));
}

function eventFeed(value: unknown): MissionFeedItem[] {
  const root = isRecord(value) ? value.events : [];
  return arrayOfRecords(root).slice(0, 5).map((event) => ({
    id: `knowledge-${String(event.id)}`,
    scope: "system" as const,
    event: String(event.type ?? "Knowledge event").replaceAll("_", " "),
    actor: "Knowledge system",
    source: String(event.projectId ?? event.workspaceId ?? "Organization"),
    timestamp: relativeDate(event.createdAt),
    tone: String(event.type ?? "").includes("accepted") ? "positive" as const : "neutral" as const,
    href: "/memory",
  }));
}

function mergeHealth(value: unknown, fallback: HealthItem[]): HealthItem[] {
  if (!isRecord(value)) return fallback;
  const healthy = value.status === "ok" && value.db === "connected";
  return fallback.map((item) => item.id === "postgres" ? {
    ...item,
    status: healthy ? "healthy" : "down",
    value: healthy ? "Connected" : "Disconnected",
    detail: relativeDate(value.timestamp),
  } : item);
}

export class HttpMissionControlService implements MissionControlService {
  async load(signal?: AbortSignal): Promise<MissionControlData> {
    const requests = [
      ["agents", "/api/agents"],
      ["projects", "/api/projects"],
      ["tasks", "/api/tasks"],
      ["rooms", "/api/rooms"],
      ["health", "/api/health"],
      ["graph", "/api/graph"],
      ["events", "/api/knowledge/events?limit=12"],
    ] as const;
    const settled = await Promise.allSettled(requests.map(([, path]) => readJson(path, signal)));
    const values = new Map<string, unknown>();
    const liveSources: string[] = [];
    settled.forEach((result, index) => {
      if (result.status === "fulfilled") {
        values.set(requests[index][0], result.value);
        liveSources.push(requests[index][0]);
      }
    });

    const fallback = structuredClone(MOCK_MISSION_CONTROL);
    const continueItems = liveContinueItems(values.get("projects"), values.get("rooms"));
    const feed = [...eventFeed(values.get("events")), ...blockedTaskFeed(values.get("tasks"))];
    const graph = isRecord(values.get("graph")) ? values.get("graph") as UnknownRecord : null;
    const graphNodes = graph ? arrayOfRecords(graph.nodes) : [];

    return {
      ...fallback,
      generatedAt: new Date().toISOString(),
      freshness: liveSources.length === requests.length ? "live" : liveSources.length > 0 ? "mixed" : "mock",
      stale: liveSources.length < requests.length,
      agents: mergeAgents(values.get("agents"), fallback.agents),
      continueItems: continueItems.length > 0 ? continueItems : fallback.continueItems,
      feed: feed.length > 0 ? [...feed, ...fallback.feed].slice(0, 8) : fallback.feed,
      health: mergeHealth(values.get("health"), fallback.health),
      neural: graphNodes.length > 0 ? {
        ...fallback.neural,
        nodes: graphNodes.slice(0, 9).map((node, index) => ({
          id: String(node.id ?? `node-${index}`),
          label: String(node.label ?? node.title ?? "Context"),
          kind: index === 0 ? "focus" : "memory",
        })),
        counts: { ...fallback.neural.counts, memories: graphNodes.length },
      } : fallback.neural,
      liveSources,
      mockedSources: [
        ...requests.filter(([name]) => !liveSources.includes(name)).map(([name]) => name),
        ...fallback.mockedSources,
      ],
    };
  }

  async resolveAttention(id: string, action: AttentionAction): Promise<{ ok: boolean }> {
    void id;
    void action;
    await new Promise((resolve) => window.setTimeout(resolve, 250));
    return { ok: true };
  }
}

export const missionControlService = new HttpMissionControlService();
