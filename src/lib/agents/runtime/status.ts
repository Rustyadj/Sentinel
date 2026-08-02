import { db } from "@/lib/db";
import { asRuntimeInstance } from "./config";
import { getRuntimeAdapter } from "./service";
import { toAgentSession } from "./store";
import type {
  AgentSession,
  RuntimeEventType,
  RuntimeHealth,
  RuntimeOperationalState,
  RuntimeOperationalStatus,
  RuntimeView,
} from "./types";

const ACTIVE_SESSION_STATUSES = new Set(["created", "ready", "running"]);
const STREAMING_EVENTS = new Set<RuntimeEventType>(["assistant_delta", "stdout", "stderr"]);
const THINKING_EVENTS = new Set<RuntimeEventType>([
  "status",
  "tool_started",
  "tool_completed",
  "command_started",
  "command_completed",
  "approval_required",
]);

const PROVIDER_NAMES: Record<RuntimeView["kind"], string> = {
  hermes: "Hermes",
  openclaw: "OpenClaw",
  "claude-code": "Anthropic",
  codex: "OpenAI",
};

export function deriveOperationalState(input: {
  health: RuntimeHealth;
  currentSession: AgentSession | null;
  latestEventType: RuntimeEventType | null;
}): RuntimeOperationalState {
  const { health, currentSession, latestEventType } = input;
  if (!health.installed && !health.reachable && !health.processRunning) return "offline";
  if (health.degraded && !health.ready) return "error";
  if (currentSession?.status === "running") {
    if (latestEventType && STREAMING_EVENTS.has(latestEventType)) return "streaming";
    if (latestEventType && THINKING_EVENTS.has(latestEventType)) return "thinking";
    return "thinking";
  }
  if (health.busy) return "busy";
  if (currentSession) return "idle";
  return health.ready ? "online" : "offline";
}

function unavailableHealth(message: string): RuntimeHealth {
  return {
    installed: false,
    processRunning: false,
    reachable: false,
    authenticated: null,
    ready: false,
    busy: false,
    degraded: true,
    failureCode: "health_check_failed",
    message,
    checkedAt: new Date().toISOString(),
  };
}

function textMetadata(metadata: Record<string, unknown>, key: string) {
  const value = metadata[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export async function getRuntimeOperationalStatus(runtime: RuntimeView): Promise<RuntimeOperationalStatus> {
  const adapter = getRuntimeAdapter(runtime.kind);
  const [healthResult, sessionsResult, workspaceResult] = await Promise.allSettled([
    adapter.health(asRuntimeInstance(runtime)),
    db.agentSession.findMany({
      where: { runtimeInstanceId: runtime.id },
      orderBy: { lastActivityAt: "desc" },
      take: 25,
      include: { events: { orderBy: { sequence: "desc" }, take: 1 } },
    }),
    runtime.workspaceId
      ? db.workspace.findUnique({ where: { id: runtime.workspaceId }, select: { id: true, name: true } })
      : Promise.resolve(null),
  ]);

  const health = healthResult.status === "fulfilled"
    ? healthResult.value
    : unavailableHealth(healthResult.reason instanceof Error ? healthResult.reason.message : "Runtime health is unavailable");
  const rows = sessionsResult.status === "fulfilled" ? sessionsResult.value : [];
  const currentRow = rows.find((session) => ACTIVE_SESSION_STATUSES.has(session.status)) ?? null;
  const currentSession = currentRow ? toAgentSession(currentRow) : null;
  const latestRow = currentRow ?? rows[0] ?? null;
  const latestEventType = (latestRow?.events[0]?.type as RuntimeEventType | undefined) ?? null;
  const project = currentRow?.projectId
    ? await db.project.findUnique({ where: { id: currentRow.projectId }, select: { id: true, name: true } }).catch(() => null)
    : null;
  const unavailableFields: RuntimeOperationalStatus["unavailableFields"] = [
    "runtimeUptime",
    "memory",
    "queueDepth",
  ];
  if (!runtime.model) unavailableFields.push("model");
  if (sessionsResult.status === "rejected") unavailableFields.push("sessions", "currentTask", "project");
  if (workspaceResult.status === "rejected" || !runtime.workspaceId) unavailableFields.push("workspace");

  return {
    runtimeId: runtime.id,
    agentId: runtime.agentId,
    kind: runtime.kind,
    state: deriveOperationalState({ health, currentSession, latestEventType }),
    provider: PROVIDER_NAMES[runtime.kind],
    model: runtime.model ?? null,
    version: health.version ?? null,
    health,
    currentSession,
    currentTask: currentSession ? textMetadata(currentSession.metadata, "lastTask") : null,
    workspace: workspaceResult.status === "fulfilled" ? workspaceResult.value : null,
    project,
    lastActivityAt: latestRow?.lastActivityAt.toISOString() ?? null,
    sessionUptimeSeconds: currentRow
      ? Math.max(0, Math.floor((Date.now() - currentRow.startedAt.getTime()) / 1_000))
      : null,
    // None of today's adapters exposes process metrics or a real task queue.
    // Returning null is deliberate: session duration is reported separately,
    // and the UI renders these provider-level metrics as unavailable.
    runtimeUptimeSeconds: null,
    memoryBytes: null,
    queueDepth: null,
    latestEventType,
    unavailableFields,
  };
}

export async function listRuntimeOperationalStatuses(runtimes: RuntimeView[]) {
  return Promise.all(runtimes.map(getRuntimeOperationalStatus));
}
