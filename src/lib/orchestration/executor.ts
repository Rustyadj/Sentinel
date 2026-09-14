import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { getAdapterForRuntime } from "@/lib/agents/runtime/service";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { assertConcurrentDispatchAllowed } from "@/lib/agents/coexecution-policy";

const json = (value: unknown) => value as Prisma.InputJsonValue;

/** Executes through the canonical runtime adapter layer. No CLI, Hermes, or
 * OpenClaw adapter is recreated here. `runtimeJobId` records the durable
 * AgentSession id; it is deliberately not treated as proof that a remote
 * process was cancelled. */
export async function executeOrchestrationRun(runId: string): Promise<void> {
  const run = await db.orchestrationRun.findUniqueOrThrow({ where: { id: runId } });
  if (run.status === "cancelled") return;
  const task = (run.request as { task?: string }).task;
  if (!task || !run.resolvedAgentId) throw new Error("Orchestration run has no routable task.");
  assertConcurrentDispatchAllowed([run.resolvedAgentId], Boolean((run.request as { explicitUserOverride?: boolean }).explicitUserOverride));
  const { runtime, adapter } = await getAdapterForRuntime(run.resolvedAgentId);
  const readiness = await adapter.readiness(asRuntimeInstance(runtime));
  if (!readiness.ready) throw new Error(`Runtime unavailable: ${readiness.reason ?? "not_ready"}`);

  await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "running", startedAt: new Date(), error: null } });
  const attempt = await db.executionAttempt.create({ data: {
    orchestrationRunId: run.id, attemptNumber: await db.executionAttempt.count({ where: { orchestrationRunId: run.id } }) + 1,
    agentId: runtime.agentId, adapterType: runtime.kind, model: runtime.model, status: "running",
    routingReason: json(run.routingDecision), input: json({ task, projectId: run.projectId, workspaceId: run.workspaceId }), startedAt: new Date(),
  } });
  const session = await adapter.startSession({ runtimeId: runtime.id, userId: run.userId, workspaceId: run.workspaceId ?? undefined, projectId: run.projectId ?? undefined });
  await db.executionAttempt.update({ where: { id: attempt.id }, data: { runtimeJobId: session.id } });
  const started = Date.now();
  let text = "";
  try {
    for await (const event of adapter.send({ sessionId: session.id, userId: run.userId, prompt: task })) {
      if (event.type === "assistant_delta" && typeof event.data.text === "string") text += event.data.text;
      const current = await db.orchestrationRun.findUnique({ where: { id: run.id }, select: { status: true } });
      // The local worker is the process owner. Adapter cancellation is only
      // requested here; success is reported only after the adapter confirms it.
      if (current?.status === "cancelled") {
        const cancelled = await adapter.cancel(session.id);
        if (!cancelled.success) throw new Error(`Cancellation not confirmed: ${cancelled.message}`);
        await db.executionAttempt.update({ where: { id: attempt.id }, data: { status: "cancelled", completedAt: new Date(), latencyMs: Date.now() - started } });
        return;
      }
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "Runtime execution failed";
    await db.executionAttempt.update({ where: { id: attempt.id }, data: { status: "failed", error: message, completedAt: new Date(), latencyMs: Date.now() - started, validation: json({ passed: false, reason: message }) } });
    await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "failed", error: message, completedAt: new Date() } });
    throw error;
  }
  const validation = { passed: text.trim().length > 0, reason: text.trim().length ? "Runtime completed with output." : "Runtime completed without output." };
  await db.$transaction([
    db.executionAttempt.update({ where: { id: attempt.id }, data: { status: validation.passed ? "succeeded" : "failed", output: json({ text }), validation: json(validation), error: validation.passed ? null : validation.reason, completedAt: new Date(), latencyMs: Date.now() - started } }),
    db.orchestrationRun.update({ where: { id: run.id }, data: { status: validation.passed ? "succeeded" : "failed", result: json({ text, attemptId: attempt.id }), validation: json(validation), error: validation.passed ? null : validation.reason, completedAt: new Date() } }),
  ]);
  await writeAuditLog({ workspaceId: run.workspaceId, projectId: run.projectId, userId: run.userId, agentId: runtime.agentId, action: validation.passed ? "orchestration.run.succeeded" : "orchestration.run.failed", entityType: "orchestration_run", entityId: run.id, details: { attemptId: attempt.id, latencyMs: Date.now() - started } });
  if (!validation.passed) throw new Error(validation.reason);
}

export async function cancelOrchestrationRun(runId: string, userId: string): Promise<boolean> {
  const run = await db.orchestrationRun.findFirst({ where: { id: runId, userId } });
  if (!run || ["succeeded", "failed", "cancelled"].includes(run.status)) return false;
  // A queued job can be cancelled durably. A running job is marked as a
  // cancellation request; the owning worker must confirm the adapter signal.
  await db.orchestrationRun.update({ where: { id: run.id }, data: { status: "cancelled", completedAt: run.status === "queued" ? new Date() : undefined } });
  await writeAuditLog({ workspaceId: run.workspaceId, projectId: run.projectId, userId, action: "orchestration.run.cancel_requested", entityType: "orchestration_run", entityId: run.id, details: { priorStatus: run.status } });
  return true;
}
