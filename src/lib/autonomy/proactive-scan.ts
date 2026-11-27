import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { emitCollaborationEvent } from "@/lib/orchestration/event-bus";
import { evaluateAuthority } from "./authority";
import { listActiveGrants } from "./authority-store";
import { selectProactiveWork, type Opportunity, type ProactiveSelection } from "./proactive";
import { getAutonomySettings } from "./settings-store";

/**
 * Detects work nobody asked for but that serves an existing objective, and
 * (when enabled) resumes it. Every opportunity points at an objective/room
 * that a human already started, so proactivity stays tied to assigned goals.
 *
 * Deployment switch: SENTINEL_PROACTIVE=on (like SENTINEL_OBJECTIVES), since a
 * proactive cycle spends real model compute. Per-workspace/agent behaviour is
 * then governed by AutonomySettings (proactiveExecution etc.).
 */
export function proactiveEnabled(): boolean {
  return process.env.SENTINEL_PROACTIVE === "on";
}

const LEAD_AGENT = "hermes-lisa";
const HOUR = 3_600_000;

export async function detectOpportunities(workspaceId: string, now = new Date()): Promise<Opportunity[]> {
  const grants = await listActiveGrants(workspaceId, now);
  const authorized = (agentId: string, operation: "write" | "delegate") => evaluateAuthority({ workspaceId, agentId, operation }, grants, now).authorized;

  const [failedTasks, stalledObjectives, retryExhausted] = await Promise.all([
    // Room tasks that failed or were blocked >1h ago and have had no activity since.
    db.task.findMany({
      where: { workspaceId, chatRoomId: { not: null }, status: { in: ["FAILED", "BLOCKED"] }, updatedAt: { lt: new Date(now.getTime() - HOUR) } },
      select: { id: true, title: true, status: true, chatRoomId: true, updatedAt: true, agentId: true },
      take: 20, orderBy: { updatedAt: "asc" },
    }),
    // Objectives still "running" whose last event is >6h old.
    db.objective.findMany({
      where: { workspaceId, status: { in: ["running", "blocked"] }, updatedAt: { lt: new Date(now.getTime() - 6 * HOUR) } },
      select: { id: true, title: true, status: true, updatedAt: true }, take: 20,
    }),
    // Steps that exhausted their retries: a different strategy may work.
    db.objectiveStep.findMany({
      where: { status: "failed", objective: { workspaceId, status: { notIn: ["stopped", "completed"] } } },
      select: { objectiveId: true, key: true, title: true, error: true, attempts: true }, take: 20,
    }),
  ]);

  const ageHours = (d: Date) => (now.getTime() - d.getTime()) / HOUR;
  const ops: Opportunity[] = [];
  for (const task of failedTasks) {
    ops.push({
      fingerprint: `task:${task.id}:${task.status}`, kind: "unfinished_task", workspaceId, agentId: LEAD_AGENT,
      title: `Recover ${task.status.toLowerCase()} task "${task.title}"`, detail: `No follow-up for ${Math.round(ageHours(task.updatedAt))}h.`,
      target: { type: "room", roomId: task.chatRoomId!, taskId: task.id },
      expectedValue: 0.7, strategicRelevance: 0.7, urgency: Math.min(1, ageHours(task.updatedAt) / 24), executionCost: 0.4,
      resourceAvailability: 0.8, confidence: task.status === "FAILED" ? 0.6 : 0.5, dependenciesReady: true,
      authorized: authorized(LEAD_AGENT, "delegate"),
    });
  }
  for (const objective of stalledObjectives) {
    ops.push({
      fingerprint: `objective:${objective.id}:stalled`, kind: "stalled_objective", workspaceId, agentId: LEAD_AGENT,
      title: `Re-plan stalled objective "${objective.title}"`, detail: `${objective.status} for ${Math.round(ageHours(objective.updatedAt))}h.`,
      target: { type: "objective", objectiveId: objective.id },
      expectedValue: 0.6, strategicRelevance: 0.8, urgency: Math.min(1, ageHours(objective.updatedAt) / 48), executionCost: 0.2,
      resourceAvailability: 0.9, confidence: 0.6, dependenciesReady: true, authorized: authorized(LEAD_AGENT, "write"),
    });
  }
  for (const step of retryExhausted) {
    ops.push({
      fingerprint: `step:${step.objectiveId}:${step.key}:failed`, kind: "repeated_failure", workspaceId, agentId: LEAD_AGENT,
      title: `Find an alternative for failed step "${step.title}"`, detail: (step.error ?? "").slice(0, 300),
      target: { type: "objective", objectiveId: step.objectiveId, stepKey: step.key },
      expectedValue: 0.65, strategicRelevance: 0.75, urgency: 0.5, executionCost: 0.3, resourceAvailability: 0.8,
      confidence: Math.max(0.3, 0.7 - 0.05 * step.attempts), dependenciesReady: true, authorized: authorized(LEAD_AGENT, "write"),
    });
  }
  return ops;
}

export interface ProactiveCycleResult { workspaceId: string; selection: ProactiveSelection; started: string[] }

/**
 * One proactive pass for one workspace. Selected room work resumes Lisa's
 * loop with a recovery seed (her approval/authority gates still apply to
 * every task she starts); objective work re-queues the failed step once.
 * Each start is recorded as a collaboration/objective event so it is
 * auditable and deduplicated next time.
 */
export async function runProactiveCycle(workspaceId: string, deps: { resumeRoom: (roomId: string, userId: string, seed: string) => Promise<void> }, now = new Date()): Promise<ProactiveCycleResult> {
  const settings = await getAutonomySettings(workspaceId, LEAD_AGENT);
  const since = new Date(now.getTime() - 24 * HOUR);
  const [roomEvents, stepEvents, everRetried] = await Promise.all([
    db.collaborationEvent.findMany({ where: { type: "proactive.started", occurredAt: { gte: since }, chatRoom: { project: { workspaceId } } }, select: { payload: true, occurredAt: true }, orderBy: { occurredAt: "desc" }, take: 500 }),
    db.objectiveEvent.findMany({ where: { type: "proactive.retry", createdAt: { gte: since }, objective: { workspaceId } }, select: { data: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 500 }),
    // A failed step is proactively retried at most once, ever — afterwards it needs a human or a new plan.
    db.objectiveEvent.findMany({ where: { type: "proactive.retry", objective: { workspaceId } }, select: { data: true }, take: 2000 }),
  ]);
  const fp = (value: unknown) => String((value as Record<string, unknown> | null)?.fingerprint ?? "");
  const starts = [...roomEvents.map((e) => ({ fingerprint: fp(e.payload), at: e.occurredAt })), ...stepEvents.map((e) => ({ fingerprint: fp(e.data), at: e.createdAt }))]
    .sort((a, b) => b.at.getTime() - a.at.getTime());
  const history = {
    recentFingerprints: new Set([...starts.map((s) => s.fingerprint), ...everRetried.map((e) => fp(e.data))]),
    lastActivationAt: starts[0]?.at ?? null,
    startsLast24h: starts.length,
  };
  const selection = selectProactiveWork(await detectOpportunities(workspaceId, now), settings, history, now);
  const started: string[] = [];
  for (const op of selection.execute) {
    try {
      if (op.target.type === "room") {
        const room = await db.chatRoom.findUnique({ where: { id: op.target.roomId }, select: { userId: true, paused: true } });
        if (!room?.userId || room.paused) continue;
        await emitCollaborationEvent(op.target.roomId, "proactive.started", { workspaceId, fingerprint: op.fingerprint, kind: op.kind, score: op.score, title: op.title });
        await deps.resumeRoom(op.target.roomId, room.userId, `Proactive follow-up (Sentinel detected this, nobody asked): ${op.title}. ${op.detail} Diagnose why it stopped, choose an alternative approach if the first one failed, and continue. Completed work is preserved.`);
      } else if (op.target.stepKey) {
        const reset = await db.objectiveStep.updateMany({ where: { objectiveId: op.target.objectiveId, key: op.target.stepKey, status: "failed", objective: { workspaceId } }, data: { status: "pending", attempts: 0, error: null, nextAttemptAt: null } });
        if (!reset.count) continue;
        await db.objectiveEvent.create({ data: { objectiveId: op.target.objectiveId, stepKey: op.target.stepKey, type: "proactive.retry", message: `${op.title}: re-queued once by proactive recovery`, data: { fingerprint: op.fingerprint, score: op.score } } });
        await db.objective.updateMany({ where: { id: op.target.objectiveId, status: { in: ["failed", "blocked"] } }, data: { status: "running" } });
      } else {
        continue; // stalled objective without a concrete step: surfaced in metrics/UI, not auto-executed
      }
      started.push(op.fingerprint);
    } catch (error) {
      logger.warn("autonomy.proactive_start_failed", { fingerprint: op.fingerprint, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return { workspaceId, selection, started };
}
