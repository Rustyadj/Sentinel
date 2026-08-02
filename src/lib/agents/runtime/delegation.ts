import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { RuntimeError } from "./errors";
import { toAgentSession } from "./store";

export interface DelegateSessionInput {
  sourceSessionId: string;
  targetAgentId: string;
  reason: string;
  context?: Record<string, unknown>;
  actorUserId: string;
}

function asJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

function assertDelegationInput(input: DelegateSessionInput) {
  if (!input.targetAgentId.trim() || input.targetAgentId.length > 200) {
    throw new RuntimeError("targetAgentId is invalid", "invalid_body", 400);
  }
  if (!input.reason.trim() || input.reason.length > 1_000) {
    throw new RuntimeError("reason is required and must be at most 1000 characters", "invalid_body", 400);
  }
  if (JSON.stringify(input.context ?? {}).length > 20_000) {
    throw new RuntimeError("delegation context is too large", "invalid_body", 400);
  }
}

/**
 * Create the smallest durable handoff primitive: one target-owned session,
 * explicit parent lineage, ordered events on both sides, and one audit row.
 * There is intentionally no cross-workspace override. Until a separately
 * authorized cross-tenant policy exists, every mismatch fails closed.
 */
export async function delegateSession(input: DelegateSessionInput) {
  assertDelegationInput(input);

  return db.$transaction(async (tx) => {
    // Use the same lock key as RuntimeSessionStore.append() so a concurrent
    // provider event cannot claim the same source-session sequence number.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`runtime-event:${input.sourceSessionId}`}))`;
    const source = await tx.agentSession.findUnique({ where: { id: input.sourceSessionId } });
    if (!source) throw new RuntimeError("Session not found", "session_not_found", 404);
    if (source.userId !== input.actorUserId) {
      throw new RuntimeError("Session not found", "session_not_found", 404);
    }
    if (!source.workspaceId) {
      throw new RuntimeError("Source session has no authorized workspace", "workspace_mismatch", 403);
    }
    if (source.agentId === input.targetAgentId) {
      throw new RuntimeError("Target agent must differ from the source agent", "invalid_body", 400);
    }

    if (source.projectId) {
      const project = await tx.project.findUnique({
        where: { id: source.projectId },
        select: { workspaceId: true },
      });
      if (!project || project.workspaceId !== source.workspaceId) {
        throw new RuntimeError("Source project is outside the session workspace", "workspace_mismatch", 403);
      }
    }

    const [targetAgent, targetRuntime] = await Promise.all([
      tx.agent.findUnique({ where: { id: input.targetAgentId }, select: { id: true, workspaceId: true } }),
      tx.agentRuntime.findFirst({
        where: { agentId: input.targetAgentId, workspaceId: source.workspaceId, enabled: true },
        orderBy: { id: "asc" },
      }),
    ]);

    if (targetAgent && targetAgent.workspaceId !== source.workspaceId) {
      throw new RuntimeError("Cross-workspace delegation is not authorized", "workspace_mismatch", 403);
    }
    if (!targetRuntime) {
      throw new RuntimeError("Target agent has no runtime in this workspace", "runtime_not_found", 404);
    }

    const context = input.context ?? {};
    const delegated = await tx.agentSession.create({
      data: {
        runtime: targetRuntime.kind,
        runtimeInstanceId: targetRuntime.id,
        agentId: targetRuntime.agentId,
        userId: source.userId,
        workspaceId: source.workspaceId,
        projectId: source.projectId,
        chatRoomId: source.chatRoomId,
        workingDirectory: targetRuntime.workingDirectoryRoot,
        status: "ready",
        parentSessionId: source.id,
        metadata: asJson({
          delegation: {
            sourceSessionId: source.id,
            sourceAgentId: source.agentId,
            reason: input.reason.trim(),
            context,
          },
        }),
      },
    });

    const aggregate = await tx.agentRuntimeEvent.aggregate({
      where: { sessionId: source.id },
      _max: { sequence: true },
    });
    const payload = asJson({
      sourceSessionId: source.id,
      targetSessionId: delegated.id,
      sourceAgentId: source.agentId,
      targetAgentId: targetRuntime.agentId,
      reason: input.reason.trim(),
      context,
    });
    await tx.agentRuntimeEvent.createMany({
      data: [
        {
          sessionId: source.id,
          sequence: (aggregate._max.sequence ?? 0) + 1,
          type: "delegated",
          payload,
        },
        { sessionId: delegated.id, sequence: 1, type: "delegated", payload },
      ],
    });
    await tx.agentSession.update({ where: { id: source.id }, data: { lastActivityAt: new Date() } });
    await writeAuditLog({
      workspaceId: source.workspaceId,
      projectId: source.projectId,
      userId: input.actorUserId,
      action: "agent_runtime.session_delegated",
      entityType: "AgentSession",
      entityId: delegated.id,
      details: {
        sourceSessionId: source.id,
        sourceAgentId: source.agentId,
        targetAgentId: targetRuntime.agentId,
        targetRuntimeId: targetRuntime.id,
        reason: input.reason.trim(),
      },
    }, tx);

    return toAgentSession(delegated);
  });
}
