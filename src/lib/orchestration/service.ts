import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { retrieveContextWithProvenance } from "@/lib/neural-engine/knowledge-bridge";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { resolveScope } from "./scope";
import { selectWorker } from "./worker-router";
import { listRuntimeViews } from "@/lib/agents/runtime/service";
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
  const scope = await resolveScope(caller.userId, input);
  if (input.projectHint && !scope.projectId) throw new Error("Project could not be resolved within your permitted scope.");
  if (input.workspaceHint && !scope.workspaceId) throw new Error("Workspace could not be resolved within your permitted scope.");
  const runtimes = await listRuntimeViews();
  const eligible = runtimes.filter((runtime) => runtime.enabled && (input.preferredAgentId ? runtime.agentId === input.preferredAgentId : true));
  if (!eligible.length) throw new Error("Requested agent is unavailable.");
  // selectWorker is the sole worker-selection authority. A run is a single
  // dispatch, so this never creates a Claude/Codex split implicitly.
  const routing = await selectWorker({
    chatRoomId: `external:${caller.userId}:${scope.projectId ?? scope.workspaceId ?? "global"}`,
    requiredCapabilities: taskCapabilities(input),
    candidates: eligible.map((runtime) => runtime.agentId),
  });
  const context = await retrieveContextWithProvenance({
    userId: caller.userId,
    projectId: scope.projectId ?? undefined,
    workspaceId: scope.workspaceId ?? undefined,
    maxItems: 12,
    scopePolicy: "user-context",
  });
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
      contextSnapshot: json({ scope, memoryCount: context.memories.length, noteCount: context.notes.length, decisionCount: context.decisions.length }),
      retrievedObjectIds: context.knowledgeObjectIds,
    },
  });
  await writeAuditLog({
    workspaceId: run.workspaceId,
    projectId: run.projectId,
    userId: caller.userId,
    action: "orchestration.run.queued",
    entityType: "orchestration_run",
    entityId: run.id,
    details: { resolvedAgentId: routing.agentId, requiredCapabilities: taskCapabilities(input), retrievedObjectCount: context.knowledgeObjectIds.length },
  });
  return run;
}
