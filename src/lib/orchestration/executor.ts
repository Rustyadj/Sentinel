import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAdapterForRuntime } from "@/lib/agents/runtime/service";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { assertConcurrentDispatchAllowed } from "@/lib/agents/coexecution-policy";
import { acquireExecutionOwnership, orchestrationWorkerId, releaseExecutionOwnership, renewExecutionOwnership } from "./execution-ownership";
import { UnrecoverableError } from "bullmq";
import { buildMemoryContext, withMemoryContext } from "@/lib/neural-engine/memory-context";

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Executes through the canonical runtime adapter layer. No CLI, Hermes, or
 * OpenClaw adapter is recreated here. `runtimeJobId` records the durable
 * AgentSession id; it is deliberately not treated as proof that a remote
 * process was cancelled. */
export async function executeOrchestrationRun(runId: string, workerId = orchestrationWorkerId()): Promise<void> {
  if (!await acquireExecutionOwnership(runId, workerId)) throw new Error("Execution ownership is held by another worker or Redis is unavailable.");
  let sessionId: string | null = null;
  let ownershipLost = false;
  let adapterForLease: Awaited<ReturnType<typeof getAdapterForRuntime>>["adapter"] | null = null;
  const renewal = setInterval(() => { void renewExecutionOwnership(runId, workerId).then(async (renewed) => {
    if (renewed || ownershipLost) return;
    ownershipLost = true;
    if (sessionId && adapterForLease) await adapterForLease.cancel(sessionId).catch(() => undefined);
  }); }, 30_000);
  try {
  const run = await db.orchestrationRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status === "cancelled") return;
  if (run.status === "cancelling") {
    await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "cancelled", completedAt: new Date() } });
    return;
  }
  const task = (run.request as { task?: string }).task;
  if (!task || !run.resolvedAgentId) throw new Error("Orchestration run has no routable task.");
  const related = await db.orchestrationRun.findMany({
    where: { status: { in: ["queued", "running", "cancelling"] }, OR: [{ id: run.id }, { parentRunId: run.id }, ...(run.parentRunId ? [{ id: run.parentRunId }, { parentRunId: run.parentRunId }] : [])] },
    select: { resolvedAgentId: true },
  });
  assertConcurrentDispatchAllowed(related.map((item) => item.resolvedAgentId).filter((id): id is string => Boolean(id)));
  const priorSession = await db.executionAttempt.findFirst({ where: { orchestrationRunId: run.id, runtimeJobId: { not: null } } });
  if (priorSession) throw new UnrecoverableError("Run already started an external runtime session; retry is forbidden to prevent duplicate side effects.");
  const { runtime, adapter } = await getAdapterForRuntime(run.resolvedAgentId);
  adapterForLease = adapter;
  // Verification is checked before readiness so a reachable-but-unverified
  // runtime can never be executed against on the strength of its health alone.
  if (!runtime.executionVerified) {
    throw new UnrecoverableError(`Runtime ${runtime.agentId} has no verified execution contract; execution is blocked until an operator verifies it.`);
  }
  const readiness = await adapter.readiness(asRuntimeInstance(runtime));
  if (!readiness.ready) throw new Error(`Runtime unavailable: ${readiness.reason ?? "not_ready"}`);

  const claimed = await db.orchestrationRun.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "running", startedAt: new Date(), error: null } });
  if (claimed.count === 0) {
    const current = await db.orchestrationRun.findUniqueOrThrow({ where: { id: run.id }, select: { status: true } });
    if (current.status === "cancelled" || current.status === "cancelling") return;
    throw new Error(`Run cannot be claimed from status ${current.status}.`);
  }
  const attempt = await db.executionAttempt.create({ data: {
    orchestrationRunId: run.id, attemptNumber: await db.executionAttempt.count({ where: { orchestrationRunId: run.id } }) + 1,
    agentId: runtime.agentId, adapterType: runtime.kind, model: runtime.model, status: "running",
    routingReason: json(run.routingDecision), input: json({ task, projectId: run.projectId, workspaceId: run.workspaceId }), startedAt: new Date(),
  } });
  // Sentinel is the memory authority: every runtime — Hermes Nathan2, Hermes
  // Lisa, Claude Code, Codex, Gemini — receives memory through this one
  // governed path, and none of them retrieves memory for itself. Scope and
  // authorization are inherited wholesale from buildRetrievalFilters; nothing
  // is widened here.
  const memory = await buildMemoryContext(
    {
      userId: run.userId,
      projectId: run.projectId ?? undefined,
      workspaceId: run.workspaceId ?? undefined,
      maxItems: 12,
      scopePolicy: "user-context",
    },
    { consumer: "orchestration", runId: run.id },
  );
  const prompt = withMemoryContext(task, memory.context);
  await db.orchestrationRun.update({
    where: { id: run.id },
    data: {
      retrievedObjectIds: memory.knowledgeObjectIds,
      contextSnapshot: json({
        ...(run.contextSnapshot as Record<string, unknown> | null ?? {}),
        memory: {
          retrieved: memory.retrievedMemoryIds.length,
          injected: memory.context.injected.length,
          dropped: memory.context.droppedMemoryIds.length,
          contextTokens: memory.context.estimatedTokens,
        },
      }),
    },
  }).catch(() => undefined);

  const session = await adapter.startSession({ runtimeId: runtime.id, userId: run.userId, workspaceId: run.workspaceId ?? undefined, projectId: run.projectId ?? undefined });
  sessionId = session.id;
  await db.executionAttempt.update({ where: { id: attempt.id }, data: { runtimeJobId: session.id } });
  const started = Date.now();
  let text = "";
  try {
    for await (const event of adapter.send({ sessionId: session.id, userId: run.userId, prompt })) {
      if (ownershipLost) throw new Error("Execution ownership lease was lost; adapter cancellation was requested.");
      if (event.type === "assistant_delta" && typeof event.data.text === "string") text += event.data.text;
      const current = await db.orchestrationRun.findUnique({ where: { id: run.id }, select: { status: true } });
      // The local worker is the process owner. Adapter cancellation is only
      // requested here; success is reported only after the adapter confirms it.
      if (current?.status === "cancelling" || current?.status === "cancelled") {
        const cancelled = await adapter.cancel(session.id);
        if (!cancelled.success) throw new Error(`Cancellation not confirmed: ${cancelled.message}`);
        await db.$transaction([
          db.executionAttempt.update({ where: { id: attempt.id }, data: { status: "cancelled", completedAt: new Date(), latencyMs: Date.now() - started } }),
          db.orchestrationRun.update({ where: { id: run.id }, data: { status: "cancelled", completedAt: new Date() } }),
        ]);
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runtime execution failed";
    await db.executionAttempt.update({ where: { id: attempt.id }, data: { status: "failed", error: message, completedAt: new Date(), latencyMs: Date.now() - started, validation: json({ passed: false, reason: message }) } });
    await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "failed", error: message, completedAt: new Date() } });
    throw error;
  }
  if (ownershipLost) throw new Error("Execution ownership lease was lost; adapter cancellation was requested.");
  const validation = { passed: text.trim().length > 0, reason: text.trim().length ? "Runtime completed with output." : "Runtime completed without output." };
  await db.$transaction([
    db.executionAttempt.update({ where: { id: attempt.id }, data: { status: validation.passed ? "succeeded" : "failed", output: json({ text }), validation: json(validation), error: validation.passed ? null : validation.reason, completedAt: new Date(), latencyMs: Date.now() - started } }),
    db.orchestrationRun.update({ where: { id: run.id }, data: { status: validation.passed ? "succeeded" : "failed", result: json({ text, attemptId: attempt.id }), validation: json(validation), error: validation.passed ? null : validation.reason, completedAt: new Date() } }),
  ]);
  await writeAuditLog({ workspaceId: run.workspaceId, projectId: run.projectId, userId: run.userId, agentId: runtime.agentId, action: validation.passed ? "orchestration.run.succeeded" : "orchestration.run.failed", entityType: "orchestration_run", entityId: run.id, details: { attemptId: attempt.id, latencyMs: Date.now() - started } });
  if (!validation.passed) throw new Error(validation.reason);
  } finally {
    clearInterval(renewal);
    await releaseExecutionOwnership(runId, workerId);
  }
}

export interface CancellationRequest { accepted: boolean; status: "cancelled" | "cancelling"; }

export async function cancelOrchestrationRun(runId: string, userId: string): Promise<CancellationRequest | null> {
  const run = await db.orchestrationRun.findFirst({ where: { id: runId, userId } });
  if (!run || ["succeeded", "failed", "cancelled", "cancelling"].includes(run.status)) return null;
  // Claim queued cancellation atomically. If a worker won the queued→running
  // race, only request cancellation; never overwrite its running state.
  const cancelledQueued = run.status === "queued" && await db.orchestrationRun.updateMany({ where: { id: run.id, status: "queued" }, data: { status: "cancelled", completedAt: new Date() } });
  const status = cancelledQueued && cancelledQueued.count === 1 ? "cancelled" : "cancelling";
  if (status === "cancelling") {
    const requested = await db.orchestrationRun.updateMany({ where: { id: run.id, status: "running" }, data: { status: "cancelling" } });
    if (!requested.count) return null;
  }
  await writeAuditLog({ workspaceId: run.workspaceId, projectId: run.projectId, userId, action: "orchestration.run.cancel_requested", entityType: "orchestration_run", entityId: run.id, details: { priorStatus: run.status } });
  return { accepted: true, status };
}
