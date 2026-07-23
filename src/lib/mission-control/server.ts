import { db } from "@/lib/db";
import { getAccessibleWorkspaceIds } from "@/lib/agents/permissions";
import { redisHealth } from "@/lib/redis";
import type {
  AgentOperation,
  AttentionItem,
  DataSourceState,
  HealthItem,
  MissionControlData,
  MissionFeedItem,
  NeuralPreviewData,
  OperationalStatus,
  Severity,
} from "./types";

type ControlPlaneUser = { id: string; name: string | null; email: string };
type TelemetryAgent = {
  id?: string;
  status?: string;
  currentTask?: string;
  progress?: number;
  runtimeSeconds?: number;
  costToday?: number;
  cpuPercent?: number;
  memoryBytes?: number;
  voiceState?: string;
  apiUsage?: { requests?: number; inputTokens?: number; outputTokens?: number };
};
type TelemetryPayload = {
  observedAt?: string;
  host?: { cpuPercent?: number; memoryUsedBytes?: number; memoryTotalBytes?: number; diskUsedBytes?: number; diskTotalBytes?: number; network?: string };
  containers?: Array<{ name?: string; status?: string }>;
  postgres?: { ok?: boolean; latencyMs?: number };
  redis?: { ok?: boolean; latencyMs?: number };
  agents?: TelemetryAgent[];
};

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null;

function relativeTime(value: Date | string): string {
  const timestamp = new Date(value).getTime();
  const minutes = Math.max(1, Math.round((Date.now() - timestamp) / 60_000));
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hr${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function bytes(value: number | undefined): string | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  const units = ["B", "KB", "MB", "GB", "TB"];
  let amount = value;
  let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${amount >= 10 || unit === 0 ? amount.toFixed(0) : amount.toFixed(1)} ${units[unit]}`;
}

function duration(seconds: number | undefined): string | null {
  if (typeof seconds !== "number" || seconds < 0) return null;
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${Math.round(seconds / 60)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function source(state: DataSourceState["state"], name: string, observedAt: string | null, reason?: string): DataSourceState {
  return { state, source: name, observedAt, ...(reason ? { reason } : {}) };
}

async function loadTelemetry(): Promise<{ payload: TelemetryPayload | null; source: DataSourceState }> {
  const url = process.env.SENTINEL_TELEMETRY_URL;
  if (!url) return { payload: null, source: source("unavailable", "VPS telemetry", null, "SENTINEL_TELEMETRY_URL is not configured") };
  try {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 4_000);
    const response = await fetch(url, {
      signal: controller.signal,
      cache: "no-store",
      headers: process.env.SENTINEL_TELEMETRY_TOKEN ? { Authorization: `Bearer ${process.env.SENTINEL_TELEMETRY_TOKEN}` } : undefined,
    });
    clearTimeout(timeout);
    if (!response.ok) throw new Error(`telemetry returned ${response.status}`);
    const raw: unknown = await response.json();
    if (!isRecord(raw)) throw new Error("telemetry payload is not an object");
    const payload = raw as TelemetryPayload;
    const observedAt = typeof payload.observedAt === "string" ? payload.observedAt : new Date().toISOString();
    const age = Date.now() - Date.parse(observedAt);
    const state = Number.isFinite(age) && age > 120_000 ? "stale" : "live";
    return { payload, source: source(state, "VPS telemetry", observedAt, state === "stale" ? "Last observation is more than two minutes old" : undefined) };
  } catch (error) {
    return { payload: null, source: source("unavailable", "VPS telemetry", null, error instanceof Error ? error.message : "Telemetry request failed") };
  }
}

function severity(priority: string): Severity {
  if (priority === "urgent" || priority === "critical") return "critical";
  if (priority === "high") return "high";
  if (priority === "low") return "low";
  return "medium";
}

function agentStatus(value: string | undefined, fallback: string): OperationalStatus {
  const candidate = value ?? fallback;
  return ["online", "busy", "idle", "offline", "error"].includes(candidate) ? candidate as OperationalStatus : "offline";
}

function auditTone(action: string): MissionFeedItem["tone"] {
  if (action.includes("reject") || action.includes("fail") || action.includes("block")) return "critical";
  if (action.includes("approve") || action.includes("complete") || action.includes("create")) return "positive";
  return "neutral";
}

export async function buildMissionControlData(user: ControlPlaneUser): Promise<MissionControlData> {
  const generatedAt = new Date().toISOString();
  const workspaceIds = await getAccessibleWorkspaceIds(user.id);
  const projectScope = { OR: [{ userId: user.id }, { workspaceId: { in: workspaceIds } }] };
  const sinceToday = new Date();
  sinceToday.setHours(0, 0, 0, 0);

  // Accessible project ids, fetched ahead of the main batch so the
  // experience/learningCandidate queries below can be scoped at the query
  // level rather than pulling every tenant's rows into memory to filter.
  const accessibleProjects = await db.project.findMany({ where: projectScope, select: { id: true } });
  const accessibleProjectIds = accessibleProjects.map((project) => project.id);

  const [workspaces, projects, rooms, tasks, agents, approvals, candidates, auditLogs, knowledgeEvents, knowledgeObjects, runningExperiences, costAggregates, redis, telemetry] = await Promise.all([
    db.workspace.findMany({ where: { id: { in: workspaceIds }, enabled: true }, orderBy: { updatedAt: "desc" }, select: { id: true, name: true, organization: { select: { name: true } }, updatedAt: true } }),
    db.project.findMany({ where: projectScope, orderBy: { updatedAt: "desc" }, take: 20, select: { id: true, name: true, description: true, status: true, workspaceId: true, updatedAt: true } }),
    db.chatRoom.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 10, select: { id: true, name: true, projectId: true, agentIds: true, createdAt: true } }),
    db.task.findMany({ where: { OR: [{ workspaceId: { in: workspaceIds } }, { project: { userId: user.id } }] }, orderBy: { updatedAt: "desc" }, take: 100, select: { id: true, title: true, description: true, status: true, priority: true, assignee: true, agentId: true, workspaceId: true, projectId: true, updatedAt: true } }),
    db.agent.findMany({ where: { workspaceId: { in: workspaceIds } }, orderBy: { createdAt: "asc" }, select: { id: true, name: true, role: true, status: true, model: true, workspaceId: true } }),
    db.approvalRequest.findMany({ where: { workspaceId: { in: workspaceIds }, status: "pending" }, orderBy: { createdAt: "asc" }, take: 50, select: { id: true, title: true, description: true, type: true, workspaceId: true, projectId: true, requesterAgent: { select: { name: true } }, createdAt: true } }),
    db.learningCandidate.findMany({
      where: {
        status: "proposed",
        experience: { is: { OR: [{ workspaceId: { in: workspaceIds } }, { projectId: { in: accessibleProjectIds } }] } },
      },
      orderBy: { createdAt: "asc" },
      take: 100,
      select: { id: true, type: true, riskLevel: true, evidenceCount: true, confidence: true, createdAt: true, experience: { select: { workspaceId: true, projectId: true } } },
    }),
    db.auditLog.findMany({ where: { OR: [{ userId: user.id }, { workspaceId: { in: workspaceIds } }] }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, action: true, actorType: true, agentId: true, entityType: true, workspaceId: true, projectId: true, createdAt: true } }),
    db.knowledgeEvent.findMany({ where: { OR: [{ userId: user.id }, { workspaceId: { in: workspaceIds } }] }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, type: true, workspaceId: true, projectId: true, createdAt: true } }),
    db.knowledgeObject.findMany({ where: { validTo: null, OR: [{ userId: user.id }, { workspaceId: { in: workspaceIds } }] }, orderBy: { updatedAt: "desc" }, take: 50, select: { id: true, title: true, type: true, workspaceId: true, projectId: true } }),
    // A running experience isn't bounded to "today" (it may have started
    // yesterday and still be in progress), so this is scoped and ordered by
    // recency but deliberately not date-filtered. take:200 is a safety cap on
    // concurrently in-flight runs, which is naturally small — not a proxy for
    // "all of today's volume" the way the old combined query was.
    db.experience.findMany({
      where: {
        outcomeStatus: "in_progress",
        OR: [{ workspaceId: { in: workspaceIds } }, { projectId: { in: accessibleProjectIds } }],
      },
      orderBy: { startedAt: "desc" },
      take: 200,
      select: { agentId: true, objective: true, startedAt: true },
    }),
    // Accurate per-agent cost totals via a scoped aggregate rather than
    // summing a capped findMany — this stays correct regardless of how many
    // experiences exist today, so "live" costToday never silently truncates.
    db.experience.groupBy({
      by: ["agentId"],
      where: {
        createdAt: { gte: sinceToday },
        OR: [{ workspaceId: { in: workspaceIds } }, { projectId: { in: accessibleProjectIds } }],
      },
      _sum: { cost: true },
    }),
    redisHealth(),
    loadTelemetry(),
  ]);

  // The full accessible-project set (accessibleProjectIds), not the top-20
  // display list (projects) — filtering against the truncated list here
  // would silently drop candidates/tasks belonging to a real accessible
  // project that just isn't among the 20 most recently updated.
  const accessibleProjectIdSet = new Set(accessibleProjectIds);
  const filteredTasks = tasks.filter((task) => !task.projectId || accessibleProjectIdSet.has(task.projectId) || Boolean(task.workspaceId && workspaceIds.includes(task.workspaceId)));
  const visibleCandidates = candidates.filter((candidate) => Boolean(candidate.experience && ((candidate.experience.workspaceId && workspaceIds.includes(candidate.experience.workspaceId)) || (candidate.experience.projectId && accessibleProjectIdSet.has(candidate.experience.projectId)))));
  const telemetryAgents = new Map((telemetry.payload?.agents ?? []).filter((item) => item.id).map((item) => [item.id as string, item]));
  const runningByAgent = new Map<string, (typeof runningExperiences)[number]>();
  for (const experience of runningExperiences) {
    if (!runningByAgent.has(experience.agentId)) runningByAgent.set(experience.agentId, experience);
  }
  const costByAgent = new Map(costAggregates.map((row) => [row.agentId, row._sum.cost]));

  const attention: AttentionItem[] = [
    ...approvals.map((item) => ({
      id: `approval:${item.id}`, targetId: item.id, targetType: "approval" as const, href: "/workflows?tab=approvals",
      title: item.title, detail: item.description ?? `Pending ${item.type.replaceAll("_", " ")} approval`, category: "approval" as const,
      severity: item.type.includes("security") || item.type.includes("deployment") ? "high" as const : "medium" as const,
      owner: item.requesterAgent?.name ?? "Workspace member", source: item.projectId ?? item.workspaceId, timestamp: relativeTime(item.createdAt), actions: ["approve", "reject", "review"] as AttentionItem["actions"],
    })),
    ...visibleCandidates.map((item) => ({
      id: `learning-candidate:${item.id}`, targetId: item.id, targetType: "learning-candidate" as const, href: "/memory",
      title: `Review ${item.type.replaceAll("_", " ")}`, detail: `${item.evidenceCount} evidence item${item.evidenceCount === 1 ? "" : "s"}; ${Math.round(item.confidence * 100)}% confidence`, category: item.type === "decision" ? "decision" as const : "memory" as const,
      severity: severity(item.riskLevel), owner: "Neural learning engine", source: "PostgreSQL", timestamp: relativeTime(item.createdAt), actions: ["approve", "reject", "review"] as AttentionItem["actions"],
    })),
    ...filteredTasks.filter((task) => ["blocked", "failed"].includes(task.status)).map((task) => ({
      id: `task:${task.id}`, targetId: task.id, targetType: "task" as const, href: "/workflows",
      title: task.title, detail: task.description ?? `Task is ${task.status}`, category: "task" as const, severity: severity(task.priority),
      owner: task.assignee ?? task.agentId ?? "Unassigned", source: task.projectId ?? task.workspaceId ?? "Task board", timestamp: relativeTime(task.updatedAt), actions: ["open"] as AttentionItem["actions"],
    })),
  ];

  const continueItems = [
    ...projects.slice(0, 8).map((project) => ({ id: `project:${project.id}`, type: "project" as const, title: project.name, context: project.description ?? "Project", lastActivity: relativeTime(project.updatedAt), status: project.status, href: `/projects/${project.id}` })),
    ...rooms.slice(0, 5).map((room) => ({ id: `room:${room.id}`, type: "conversation" as const, title: room.name, context: `${room.agentIds.length} agent${room.agentIds.length === 1 ? "" : "s"}`, lastActivity: relativeTime(room.createdAt), status: "Available", href: "/chat" })),
    ...workspaces.slice(0, 5).map((workspace) => ({ id: `workspace:${workspace.id}`, type: "workspace" as const, title: workspace.name, context: workspace.organization?.name ?? "Workspace", lastActivity: relativeTime(workspace.updatedAt), status: "Active", href: "/workspaces" })),
  ];

  const agentOperations: AgentOperation[] = agents.map((agent) => {
    const observed = telemetryAgents.get(agent.id);
    const running = runningByAgent.get(agent.id);
    const cost = costByAgent.get(agent.id);
    return {
      id: agent.id, name: agent.name, role: agent.role, model: agent.model,
      status: agentStatus(observed?.status, agent.status), currentTask: observed?.currentTask ?? running?.objective ?? null,
      context: agent.workspaceId ? workspaces.find((workspace) => workspace.id === agent.workspaceId)?.name ?? null : null,
      progress: typeof observed?.progress === "number" ? observed.progress : null, voiceState: ["listening", "speaking", "silent"].includes(observed?.voiceState ?? "") ? observed?.voiceState as AgentOperation["voiceState"] : "unavailable",
      health: { cpu: observed?.cpuPercent ?? null, memory: bytes(observed?.memoryBytes), runtime: duration(observed?.runtimeSeconds ?? (running ? (Date.now() - running.startedAt.getTime()) / 1000 : undefined)) },
      costToday: typeof observed?.costToday === "number" ? observed.costToday : cost ?? null,
      href: `/agents/${agent.id}`,
    };
  });

  const feed: MissionFeedItem[] = [
    ...auditLogs.map((item) => ({ createdAt: item.createdAt.getTime(), data: { id: `audit:${item.id}`, scope: item.entityType === "agent" ? "agents" as const : item.projectId ? "projects" as const : item.workspaceId ? "workspaces" as const : "system" as const, event: item.action.replaceAll("_", " "), actor: item.agentId ?? item.actorType, source: item.entityType ?? "Audit log", timestamp: relativeTime(item.createdAt), tone: auditTone(item.action), href: "/settings" } })),
    ...knowledgeEvents.map((item) => ({ createdAt: item.createdAt.getTime(), data: { id: `knowledge:${item.id}`, scope: item.projectId ? "projects" as const : item.workspaceId ? "workspaces" as const : "system" as const, event: item.type.replaceAll("_", " "), actor: "Knowledge system", source: item.projectId ?? item.workspaceId ?? "Knowledge event", timestamp: relativeTime(item.createdAt), tone: auditTone(item.type), href: "/memory" } })),
  ].sort((left, right) => right.createdAt - left.createdAt).slice(0, 30).map((item) => item.data);

  const host = telemetry.payload?.host;
  const apiUsage = (telemetry.payload?.agents ?? []).reduce((total, agent) => ({
    requests: total.requests + (agent.apiUsage?.requests ?? 0),
    inputTokens: total.inputTokens + (agent.apiUsage?.inputTokens ?? 0),
    outputTokens: total.outputTokens + (agent.apiUsage?.outputTokens ?? 0),
    observed: total.observed || Boolean(agent.apiUsage),
  }), { requests: 0, inputTokens: 0, outputTokens: 0, observed: false });
  const health: HealthItem[] = [
    { id: "cpu", label: "VPS CPU", status: typeof host?.cpuPercent === "number" ? "healthy" : "unavailable", value: typeof host?.cpuPercent === "number" ? `${host.cpuPercent.toFixed(1)}%` : "Unavailable", detail: telemetry.source.reason ?? "Host telemetry" },
    { id: "memory", label: "VPS memory", status: host?.memoryUsedBytes !== undefined ? "healthy" : "unavailable", value: host?.memoryUsedBytes !== undefined ? `${bytes(host.memoryUsedBytes)} / ${bytes(host.memoryTotalBytes) ?? "unknown"}` : "Unavailable", detail: telemetry.source.reason ?? "Host telemetry" },
    { id: "disk", label: "VPS disk", status: host?.diskUsedBytes !== undefined ? "healthy" : "unavailable", value: host?.diskUsedBytes !== undefined ? `${bytes(host.diskUsedBytes)} / ${bytes(host.diskTotalBytes) ?? "unknown"}` : "Unavailable", detail: telemetry.source.reason ?? "Host telemetry" },
    { id: "network", label: "Network", status: host?.network ? "healthy" : "unavailable", value: host?.network ?? "Unavailable", detail: telemetry.source.reason ?? "Host telemetry" },
    { id: "containers", label: "Containers", status: telemetry.payload?.containers ? (telemetry.payload.containers.every((container) => container.status === "running" || container.status === "healthy") ? "healthy" : "degraded") : "unavailable", value: telemetry.payload?.containers ? `${telemetry.payload.containers.filter((container) => container.status === "running" || container.status === "healthy").length}/${telemetry.payload.containers.length} healthy` : "Unavailable", detail: telemetry.source.reason ?? "Container telemetry" },
    { id: "postgres", label: "PostgreSQL", status: "healthy", value: "Connected", detail: "Mission Control query succeeded" },
    { id: "redis", label: "Redis", status: redis.ok ? "healthy" : redis.configured ? "down" : "unavailable", value: redis.ok ? `${redis.latencyMs ?? 0} ms` : "Unavailable", detail: redis.error ?? "Ping succeeded" },
    { id: "usage", label: "API usage", status: apiUsage.observed ? "active" : "unavailable", value: apiUsage.observed ? `${apiUsage.requests} requests` : "Unavailable", detail: apiUsage.observed ? `${apiUsage.inputTokens + apiUsage.outputTokens} tokens observed` : "Agent telemetry did not report API usage" },
  ];

  const neuralNodes: NeuralPreviewData["nodes"] = knowledgeObjects.slice(0, 9).map((item, index) => ({ id: item.id, label: item.title, kind: index === 0 ? "focus" : item.type.toLowerCase() === "decision" ? "decision" : item.type.toLowerCase() === "task" ? "task" : item.type.toLowerCase() === "agent" ? "agent" : "memory" }));
  const neural: NeuralPreviewData = {
    workspace: workspaces[0]?.name ?? null, project: projects[0]?.name ?? null, repository: null, branch: null,
    activeAgentIds: agentOperations.filter((agent) => agent.status === "online" || agent.status === "busy").map((agent) => agent.id),
    nodes: neuralNodes, edges: neuralNodes.slice(1).map((node) => ({ from: neuralNodes[0]?.id ?? node.id, to: node.id })),
    counts: { decisions: knowledgeObjects.filter((item) => item.type.toLowerCase() === "decision").length, memories: knowledgeObjects.filter((item) => item.type.toLowerCase() === "memory").length, tasks: filteredTasks.length, blocked: filteredTasks.filter((task) => ["blocked", "failed"].includes(task.status)).length },
  };

  const dbState = source("live", "PostgreSQL", generatedAt);
  const pendingApprovals = approvals.length + visibleCandidates.length;
  const blocked = filteredTasks.filter((task) => ["blocked", "failed"].includes(task.status)).length;
  const activeAgents = agentOperations.filter((agent) => agent.status === "online" || agent.status === "busy").length;
  return {
    greetingName: user.name?.split(" ")[0] ?? user.email.split("@")[0],
    operationalSummary: pendingApprovals || blocked ? `${pendingApprovals} decision${pendingApprovals === 1 ? "" : "s"} pending and ${blocked} blocked or failed task${blocked === 1 ? "" : "s"}.` : "No pending decisions or blocked tasks were found in your accessible workspaces.",
    generatedAt,
    sources: { summary: dbState, continue: dbState, attention: dbState, agents: telemetry.source.state === "live" || telemetry.source.state === "stale" ? telemetry.source : source("unavailable", "Agent runtime telemetry", null, "Runtime telemetry is unavailable; live registry fields are shown without fabricated progress, health, runtime, or cost"), feed: dbState, health: telemetry.source, neural: dbState, context: dbState },
    context: [
      ...(workspaces[0]?.organization ? [{ id: "organization" as const, label: "Organization", value: workspaces[0].organization.name, options: [...new Set(workspaces.flatMap((workspace) => workspace.organization?.name ? [workspace.organization.name] : []))] }] : []),
      ...(workspaces.length ? [{ id: "workspace" as const, label: "Workspace", value: workspaces[0].name, options: workspaces.map((workspace) => workspace.name) }] : []),
      ...(projects.length ? [{ id: "project" as const, label: "Project", value: projects[0].name, options: projects.map((project) => project.name) }] : []),
    ],
    summaryMetrics: [
      { id: "pending", label: "Pending decisions", value: pendingApprovals, detail: "Approvals and learning candidates", tone: pendingApprovals ? "warning" : "positive", actionLabel: "Review", href: "/workflows?tab=approvals" },
      { id: "blocked", label: "Blocked or failed", value: blocked, detail: "Tasks requiring intervention", tone: blocked ? "critical" : "positive", actionLabel: "Open tasks", href: "/workflows" },
      { id: "active-agents", label: "Active agents", value: activeAgents, detail: telemetry.payload ? "Runtime-observed" : "Registry-reported", tone: "neutral", actionLabel: "View agents", href: "/agents" },
      { id: "projects", label: "Active projects", value: projects.filter((project) => project.status === "active").length, detail: "Accessible projects", tone: "neutral", actionLabel: "View projects", href: "/projects" },
      { id: "events", label: "Recent events", value: feed.length, detail: "Normalized audit and knowledge events", tone: "neutral", actionLabel: "Open feed", href: "#mission-feed" },
    ],
    continueItems, attention, agents: agentOperations, feed, health, neural,
    quickActions: [
      { id: "project", label: "New project", href: "/projects", icon: "project" }, { id: "chat", label: "New chat", href: "/chat", icon: "chat" },
      { id: "voice", label: "Start voice", href: "/chat?voice=1", icon: "voice" }, { id: "task", label: "New task", href: "/workflows", icon: "task" },
      { id: "approval", label: "Approvals", href: "/workflows?tab=approvals", icon: "approval" }, { id: "module", label: "Settings", href: "/settings", icon: "module" },
    ],
  };
}
