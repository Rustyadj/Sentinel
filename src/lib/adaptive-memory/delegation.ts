import { randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emitAdaptiveEvent } from "./event-service";
import { requireAdaptiveScope } from "./scope";

export async function listAgentCapabilities(workspaceId?: string) {
  return db.agent.findMany({ where: workspaceId ? { workspaceId } : undefined,
    select: { id: true, name: true, role: true, model: true, skills: true, toolPermissions: true, status: true, workspaceId: true } });
}

export async function delegateTask(input: {
  requestId?: string; actingUserId: string; mcpClientId?: string; organizationId?: string;
  workspaceId?: string; projectId?: string; agentId: string; objective: string;
  allowedTools: string[]; maxRuntimeMs: number; maxCost: number; writePermissions: string[];
  approvalPolicy: Record<string, unknown>; expectedDeliverables: Record<string, unknown>;
  successCriteria: string[];
}) {
  await requireAdaptiveScope({ actorUserId: input.actingUserId, organizationId: input.organizationId,
    workspaceId: input.workspaceId, projectId: input.projectId, permission: "agent.delegate" });
  const agent = await db.agent.findUniqueOrThrow({ where: { id: input.agentId } });
  if (input.workspaceId && agent.workspaceId !== input.workspaceId) throw new Error("Agent is outside the delegated workspace.");
  const unauthorizedTools = input.allowedTools.filter((tool) => !agent.toolPermissions.includes(tool));
  if (unauthorizedTools.length) throw new Error(`Agent is not authorized for: ${unauthorizedTools.join(", ")}`);
  const runtimeCap = Number(process.env.DELEGATION_MAX_RUNTIME_MS ?? 3_600_000);
  const costCap = Number(process.env.DELEGATION_MAX_COST ?? 25);
  if (input.maxRuntimeMs <= 0 || input.maxRuntimeMs > runtimeCap) throw new Error(`Runtime exceeds ${runtimeCap}ms delegation cap.`);
  if (input.maxCost < 0 || input.maxCost > costCap) throw new Error(`Cost exceeds ${costCap} delegation cap.`);
  if (input.writePermissions.length && !Object.keys(input.approvalPolicy).length) throw new Error("Write-capable delegation requires an approval policy.");
  const run = await db.delegatedRun.create({ data: {
    requestId: input.requestId ?? randomUUID(), actingUserId: input.actingUserId,
    mcpClientId: input.mcpClientId, organizationId: input.organizationId,
    workspaceId: input.workspaceId, projectId: input.projectId, agentId: input.agentId,
    objective: input.objective, allowedTools: input.allowedTools, maxRuntimeMs: input.maxRuntimeMs,
    maxCost: input.maxCost, writePermissions: input.writePermissions,
    approvalPolicy: input.approvalPolicy as Prisma.InputJsonValue,
    expectedDeliverables: input.expectedDeliverables as Prisma.InputJsonValue,
    successCriteria: input.successCriteria,
  }});
  await emitAdaptiveEvent({ type: "agent.delegated", requestId: run.requestId,
    userId: input.actingUserId, agentId: input.agentId, organizationId: input.organizationId,
    workspaceId: input.workspaceId, projectId: input.projectId, payload: { runId: run.id } });
  return run;
}

export function getDelegatedRun(runId: string) { return db.delegatedRun.findUnique({ where: { id: runId } }); }

export async function cancelDelegatedRun(runId: string, actorUserId: string) {
  const run = await db.delegatedRun.findUniqueOrThrow({ where: { id: runId } });
  await requireAdaptiveScope({ actorUserId, workspaceId: run.workspaceId, projectId: run.projectId, permission: "agent.cancel" });
  if (["completed", "failed", "cancelled"].includes(run.status)) throw new Error(`Run is already ${run.status}.`);
  return db.delegatedRun.update({ where: { id: runId }, data: { cancellationRequestedAt: new Date(), status: run.status === "queued" ? "cancelled" : run.status } });
}

export async function submitRunFeedback(runId: string, actorUserId: string, feedback: Record<string, unknown>) {
  const run = await db.delegatedRun.findUniqueOrThrow({ where: { id: runId } });
  await requireAdaptiveScope({ actorUserId, workspaceId: run.workspaceId, projectId: run.projectId, permission: "agent.feedback" });
  return db.adaptiveEvent.create({ data: { type: "agent.run_feedback", runId, userId: actorUserId,
    agentId: run.agentId, workspaceId: run.workspaceId, projectId: run.projectId,
    payload: feedback as Prisma.InputJsonValue, result: "recorded" } });
}
