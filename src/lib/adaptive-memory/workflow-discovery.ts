import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { emitAdaptiveEvent } from "./event-service";
import { requireAdaptiveScope } from "./scope";
import { writeAuditLog } from "@/lib/workspaces/audit";

const json = (value: unknown) => value as Prisma.InputJsonValue;
export function workflowSignature(tools: string[], actions: unknown) {
  const normalizedActions = Array.isArray(actions) ? actions.map((action) => {
    if (typeof action === "string") return action.replace(/[0-9a-f]{8,}|\d+/gi, "{var}").toLowerCase();
    if (action && typeof action === "object") return Object.keys(action as object).sort().join(",");
    return typeof action;
  }) : [];
  return createHash("sha256").update(JSON.stringify({ tools, actions: normalizedActions })).digest("hex");
}

export async function discoverWorkflowProposals(input: {
  actorUserId: string; workspaceId?: string; projectId?: string; organizationId?: string; minimumRuns?: number;
}) {
  await requireAdaptiveScope({ ...input, permission: "workflow.write" });
  const runs = await db.experience.findMany({ where: {
    workspaceId: input.workspaceId, projectId: input.projectId,
    outcomeStatus: "success", completedAt: { gte: new Date(Date.now() - 90 * 86_400_000) },
  }, orderBy: { completedAt: "desc" }, take: 500 });
  const groups = new Map<string, typeof runs>();
  for (const run of runs) {
    if (run.toolsUsed.length < 2) continue;
    const signature = workflowSignature(run.toolsUsed, run.actionsTaken);
    groups.set(signature, [...(groups.get(signature) ?? []), run]);
  }
  const proposals = [];
  for (const [signature, group] of groups) {
    if (group.length < (input.minimumRuns ?? 3)) continue;
    const existing = await db.workflowProposal.findFirst({ where: { sourceRunIds: { hasEvery: group.map((run) => run.id) }, status: { in: ["proposed", "approved"] } } });
    if (existing) continue;
    const sample = group[0];
    const proposal = await db.workflowProposal.create({ data: {
      organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
      ownerUserId: input.actorUserId, operatorAgentId: sample.agentId,
      trigger: json({ type: "manual", signature }), inputs: json({ variables: "requires review" }),
      tools: sample.toolsUsed, requiredCredentials: [], readScope: json({ workspaceId: input.workspaceId, projectId: input.projectId }),
      writeScope: json({ allowed: false }), approvalPoints: json([{ before: "external_write" }]),
      expectedOutput: json({ objectivePattern: sample.objective }), verification: json({ required: true }),
      costEstimate: group.every((run) => run.cost != null) ? group.reduce((sum, run) => sum + (run.cost ?? 0), 0) / group.length : null,
      runtimeEstimateMs: group.every((run) => run.latencyMs != null) ? Math.round(group.reduce((sum, run) => sum + (run.latencyMs ?? 0), 0) / group.length) : null,
      failureHandling: json({ retry: "disabled_until_reviewed" }), rollback: json({ requiredBeforeActivation: true }),
      sourceRunIds: group.map((run) => run.id), repetitionCount: group.length,
      confidence: Math.min(0.95, 0.5 + group.length * 0.08), status: "proposed",
    }});
    proposals.push(proposal);
    await emitAdaptiveEvent({ type: "workflow.proposed", userId: input.actorUserId,
      agentId: sample.agentId, workspaceId: input.workspaceId, projectId: input.projectId,
      payload: { proposalId: proposal.id, repetitionCount: group.length, signature } });
  }
  return proposals;
}

export async function workflowHealth(workspaceId: string) {
  const workflows = await db.workflow.findMany({ where: { workspaceId }, orderBy: { updatedAt: "desc" } });
  return Promise.all(workflows.map(async (workflow) => {
    const latestRun = await db.workflowRun.findFirst({ where: { workflowId: workflow.id }, orderBy: { createdAt: "desc" } });
    return { id: workflow.id, name: workflow.name, ownerUserId: workflow.userId,
      operatorAgentId: workflow.operatorAgentId, version: workflow.version,
      lastRunAt: latestRun?.startedAt ?? workflow.lastRunAt,
      lastSuccessfulAt: workflow.lastSuccessfulAt, nextRunAt: workflow.nextRunAt,
      failureCount: workflow.failureCount, retryState: latestRun?.retryState ?? workflow.retryState,
      credentialStatus: latestRun?.credentialStatus ?? workflow.credentialStatus,
      toolStatus: latestRun?.toolStatus ?? workflow.toolStatus,
      runtimeMs: latestRun?.runtimeMs ?? workflow.lastRuntimeMs, cost: latestRun?.cost ?? workflow.lastCost,
      approvalStatus: workflow.approvalStatus, disabledAt: workflow.disabledAt,
      staleOutput: workflow.staleOutputAt ? workflow.staleOutputAt <= new Date() : null,
      sourceState: latestRun || workflow.lastRunAt ? "live" : "unavailable" };
  }));
}

export async function reviewWorkflowProposal(input: {
  proposalId: string; actorUserId: string; decision: "approve" | "reject";
  activate?: boolean; reviewNote?: string;
}) {
  const proposal = await db.workflowProposal.findUniqueOrThrow({ where: { id: input.proposalId } });
  await requireAdaptiveScope({ actorUserId: input.actorUserId, organizationId: proposal.organizationId,
    workspaceId: proposal.workspaceId, projectId: proposal.projectId, permission: "approval.review" });
  if (proposal.status !== "proposed") throw new Error("Workflow proposal has already been reviewed.");
  if (input.decision === "reject") {
    const rejected = await db.workflowProposal.update({ where: { id: proposal.id },
      data: { status: "rejected", reviewedAt: new Date() } });
    await writeAuditLog({ workspaceId: proposal.workspaceId, projectId: proposal.projectId,
      userId: input.actorUserId, action: "workflow.proposal_rejected", entityType: "workflowProposal",
      entityId: proposal.id, details: { reviewNote: input.reviewNote ?? null } });
    return { proposal: rejected, workflow: null };
  }

  const result = await db.$transaction(async (tx) => {
    const workflow = await tx.workflow.create({ data: {
      name: `Proposed workflow ${proposal.id.slice(-8)}`,
      description: `Human-approved from ${proposal.repetitionCount} successful runs.`,
      nodes: json(proposal.tools.map((tool, index) => ({ id: `step-${index + 1}`, tool }))),
      edges: json(proposal.tools.slice(1).map((_tool, index) => ({ from: `step-${index + 1}`, to: `step-${index + 2}` }))),
      status: input.activate ? "active" : "draft", approvalStatus: "approved",
      organizationId: proposal.organizationId, workspaceId: proposal.workspaceId,
      projectId: proposal.projectId, userId: proposal.ownerUserId,
      operatorAgentId: proposal.operatorAgentId,
    }});
    const reviewed = await tx.workflowProposal.update({ where: { id: proposal.id },
      data: { status: "approved", reviewedAt: new Date() } });
    return { proposal: reviewed, workflow };
  });
  await writeAuditLog({ workspaceId: proposal.workspaceId, projectId: proposal.projectId,
    userId: input.actorUserId, action: input.activate ? "workflow.proposal_approved_and_activated" : "workflow.proposal_approved",
    entityType: "workflow", entityId: result.workflow.id,
    details: { proposalId: proposal.id, reviewNote: input.reviewNote ?? null } });
  if (input.activate) await emitAdaptiveEvent({ type: "workflow.activated", userId: input.actorUserId,
    organizationId: proposal.organizationId ?? undefined, workspaceId: proposal.workspaceId ?? undefined,
    projectId: proposal.projectId ?? undefined, payload: { proposalId: proposal.id, workflowId: result.workflow.id } });
  return result;
}

export async function disableWorkflow(workflowId: string, actorUserId: string, reason?: string) {
  const workflow = await db.workflow.findUniqueOrThrow({ where: { id: workflowId } });
  await requireAdaptiveScope({ actorUserId, organizationId: workflow.organizationId,
    workspaceId: workflow.workspaceId, projectId: workflow.projectId, permission: "workflow.write" });
  const disabled = await db.workflow.update({ where: { id: workflowId },
    data: { status: "disabled", disabledAt: new Date(), retryState: "disabled" } });
  await emitAdaptiveEvent({ type: "workflow.disabled", userId: actorUserId,
    organizationId: workflow.organizationId ?? undefined, workspaceId: workflow.workspaceId ?? undefined,
    projectId: workflow.projectId ?? undefined, payload: { workflowId, reason: reason ?? "manual" } });
  return disabled;
}

export async function rollbackWorkflow(workflowId: string, actorUserId: string) {
  const workflow = await db.workflow.findUniqueOrThrow({ where: { id: workflowId } });
  await requireAdaptiveScope({ actorUserId, organizationId: workflow.organizationId,
    workspaceId: workflow.workspaceId, projectId: workflow.projectId, permission: "approval.review" });
  if (!workflow.rollbackWorkflowId) throw new Error("No approved rollback workflow is configured.");
  const previous = await db.workflow.findUniqueOrThrow({ where: { id: workflow.rollbackWorkflowId } });
  if (previous.workspaceId !== workflow.workspaceId || previous.projectId !== workflow.projectId || previous.approvalStatus !== "approved") {
    throw new Error("Rollback target is outside scope or not approved.");
  }
  const [, restored] = await db.$transaction([
    db.workflow.update({ where: { id: workflow.id }, data: { status: "disabled", disabledAt: new Date(), retryState: "rolled_back" } }),
    db.workflow.update({ where: { id: previous.id }, data: { status: "active", disabledAt: null, retryState: null } }),
  ]);
  await writeAuditLog({ workspaceId: workflow.workspaceId, projectId: workflow.projectId,
    userId: actorUserId, action: "workflow.rolled_back", entityType: "workflow", entityId: workflow.id,
    details: { restoredWorkflowId: restored.id } });
  return restored;
}
