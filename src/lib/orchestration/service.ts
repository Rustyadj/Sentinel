import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { resolveMcpContext } from "@/lib/integrations/mcp-context";
import { selectWorker } from "./worker-router";
import { enqueueOrchestrationRun } from "./queue";
import { getRuntimeAdapter, listRuntimeViews } from "@/lib/agents/runtime/service";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import type { AgentCapabilityKey } from "./capabilities";
import type { RouteTaskInput } from "./types";

function json(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

function taskCapabilities(input: RouteTaskInput): AgentCapabilityKey[] {
  const text = `${input.task} ${input.taskType ?? ""}`.toLowerCase();
  const keys: AgentCapabilityKey[] = [];
  if (/code|implement|repository|repo|file|refactor/.test(text)) keys.push("coding");
  if (/bug|error|debug/.test(text)) keys.push("debugging");
  if (/test/.test(text)) keys.push("testing");
  if (/security|auth|permission/.test(text)) keys.push("security");
  if (/database|prisma|sql/.test(text)) keys.push("database");
  if (/deploy|docker|infra/.test(text)) keys.push("devops");
  if (/research|search|investigate/.test(text)) keys.push("research");
  if (/plan|design|architecture/.test(text)) keys.push("architecture");
  return keys.length ? keys : ["research"];
}

export async function createOrchestrationRun(input: RouteTaskInput, caller: { userId: string; externalClientId?: string }) {
  const resolvedContext = await resolveMcpContext(caller.userId, {
    query: input.task, projectHint: input.projectHint, workspaceHint: input.workspaceHint,
    projectId: input.projectId, workspaceId: input.workspaceId, contextTaskId: input.contextTaskId,
  });
  const scope = resolvedContext.scope;
  if (!scope.projectId && !scope.workspaceId) {
    const choices = resolvedContext.choices;
    const projects = choices?.projects.map((project) => `${project.name} (${project.id})`).join(", ") || "none";
    const workspaces = choices?.workspaces.map((workspace) => `${workspace.name} (${workspace.id})`).join(", ") || "none";
    throw new Error(`${resolvedContext.reason} Permitted projects: ${projects}. Permitted workspaces: ${workspaces}. Retry with projectId or workspaceId.`);
  }
  const runtimes = await listRuntimeViews();
  // executionVerified is an operator assertion that this runtime has a proven
  // task-execution contract. It gates dispatch, never reachability: an agent
  // that merely answers a health check is not dispatchable.
  const configured = runtimes.filter((runtime) => input.preferredAgentId ? runtime.agentId === input.preferredAgentId : true);
  if (!configured.length) throw new Error("Requested agent is not configured or is not permitted for this operation.");
  const verified = configured.filter((runtime) => runtime.enabled && runtime.executionVerified);
  if (!verified.length) throw new Error("Requested agent is disabled or has no verified execution contract.");
  const health = await Promise.all(verified.map(async (runtime) => ({
    runtime,
    status: await getRuntimeAdapter(runtime.kind).health(asRuntimeInstance(runtime)).catch(() => null),
  })));
  const eligible = health.filter(({ status }) => status?.ready === true).map(({ runtime }) => runtime);
  if (!eligible.length) {
    const requested = health[0]?.status;
    if (input.preferredAgentId && requested?.reachable && !requested.authenticated) {
      throw new Error(`${input.preferredAgentId} is reachable but not authenticated.`);
    }
    throw new Error(input.preferredAgentId
      ? `${input.preferredAgentId} is currently unavailable for execution.`
      : "No configured Sentinel agent is currently ready for execution.");
  }
  // selectWorker is the sole worker-selection authority. A run is a single
  // dispatch, so this never creates a Claude/Codex split implicitly.
  const routing = await selectWorker({
    chatRoomId: `external:${caller.userId}:${scope.projectId ?? scope.workspaceId ?? "global"}`,
    requiredCapabilities: taskCapabilities(input),
    candidates: eligible.map((runtime) => runtime.agentId),
  });
  // Memory is deliberately NOT retrieved here any more.
  //
  // It used to be: this function retrieved memory at queue time, wrote
  // memory_retrievals rows for it, and stored the object ids on the run — and
  // then executor.ts dispatched the bare task string, so a worker never saw
  // any of it. Those phantom retrievals were still resolved against the run's
  // outcome, teaching the system that memories no agent had read were useful.
  //
  // Retrieval now happens in the executor, immediately before dispatch: the
  // run id exists by then (so retrievals are attributable to it), the context
  // is fresh rather than however stale the queue was, and — critically — what
  // is recorded as injected is what was actually put in the prompt.
  const existing = input.idempotencyKey && caller.externalClientId
    ? await db.orchestrationRun.findUnique({ where: { externalClientId_idempotencyKey: { externalClientId: caller.externalClientId, idempotencyKey: input.idempotencyKey } } })
    : null;
  if (existing) return existing;
  const run = await db.orchestrationRun.create({
    data: {
      externalClientId: caller.externalClientId ?? null,
      userId: caller.userId,
      workspaceId: scope.workspaceId,
      projectId: scope.projectId,
      idempotencyKey: input.idempotencyKey ?? null,
      request: json(input),
      requestedAgentId: input.preferredAgentId ?? null,
      resolvedAgentId: routing.agentId,
      routingDecision: json({ ...routing, requiredCapabilities: taskCapabilities(input) }),
      contextSnapshot: json({ scope }),
      retrievedObjectIds: [],
    },
  });
  await writeAuditLog({
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    userId: caller.userId,
    action: "orchestration.run.queued",
    entityType: "orchestration_run",
    entityId: run.id,
    details: { resolvedAgentId: routing.agentId, requiredCapabilities: taskCapabilities(input) },
  });
  await enqueueOrchestrationRun(run.id);
  return run;
}
