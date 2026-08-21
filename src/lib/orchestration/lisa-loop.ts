import type { Task } from "@prisma/client";
import { db } from "@/lib/db";
import { resolveAgentRuntime, runAgentTurn } from "./agent-turn";
import { assessRisk, requestApprovalGate, requiresApproval } from "./approval-gate";
import { AGENT_CAPABILITY_KEYS, type AgentCapabilityKey } from "./capabilities";
import { buildAgentContext } from "./context-builder";
import { emitCollaborationEvent } from "./event-bus";
import { acquireExecutionLock, findConflictingLock, listActiveLocks, releaseAgentLocks } from "./execution-lock";
import { postCollaborationMessage } from "./messages";
import { createRoomTask, setTaskStatus } from "./task-router";
import { currentWorkload, selectWorker } from "./worker-router";
import { ensureTaskWorktree, mergeTaskBranch } from "./worktree-manager";

/** Hard ceiling on how many turns Lisa's own reasoning loop can take for one
 *  objective before Sentinel forces a stop and asks the human (spec's loop
 *  protection — this budgets the *whole* orchestration, not just review cycles). */
const MAX_LISA_ITERATIONS = 25;
const MAX_REVIEW_CYCLES = 3;
const SENSITIVE_SCOPE_PATTERNS = [/prisma\/schema\.prisma/i, /agents\/runtime\//i, /auth\.ts$/i, /migrations\//i];

export type LisaTool =
  | "createTask" | "assignTask" | "startTask" | "pauseTask" | "cancelTask"
  | "reassignTask" | "createDependency" | "requestReview" | "requestValidation"
  | "mergeTask" | "getTaskStatus" | "getAgentStatus" | "getWorktreeStatus"
  | "getArtifact" | "DONE" | "ASK_USER";

interface Directive {
  tool: LisaTool;
  args: Record<string, unknown>;
}

interface LoopContext {
  roomId: string;
  userId: string;
  lead: string;
  pool: string[];
}

const TOOL_MENU = `Available tools — respond with ONLY a fenced json code block containing an array of {"tool": "...", "args": {...}} objects. You may call several tools in one turn when their effects are independent (e.g. starting two unrelated tasks at once actually runs them in parallel).

- createTask {title, description?, capabilities?: string[] (from: ${AGENT_CAPABILITY_KEYS.join(", ")}), fileScope?: string[], dependsOnTaskIds?: string[]} -> {taskId}
- assignTask {taskId, agentId} -> assigns a specific worker; fails with a conflict if that worker would overlap an active lock someone else holds
- startTask {taskId} -> runs the assigned worker now (auto-assigns by capability fit first if unassigned); returns status, an artifact excerpt, or APPROVAL_REQUIRED if the task is gated
- pauseTask {taskId} / cancelTask {taskId} / reassignTask {taskId, agentId}
- createDependency {taskId, dependsOnTaskId}
- requestReview {taskId, reviewerAgentId?} -> runs one cross-review pass (peer worker if reviewerAgentId omitted), returns verdict + comments
- requestValidation {taskId} -> asks the task's own owner to self-check their latest work
- mergeTask {taskId} -> merges the task's worktree branch back into the base branch; may return a merge conflict to reason about
- getTaskStatus {taskId?} -> one task, or every task in the room if taskId is omitted
- getAgentStatus {} -> workload and health for every implementation worker in the room
- getWorktreeStatus {taskId}
- getArtifact {artifactId}
- DONE {summary} -> claim the objective is complete; Sentinel verifies completion criteria (all tasks resolved, no pending approvals/disagreements/locks) before accepting — if rejected, keep going
- ASK_USER {question} -> pause and ask the human operator; the room resumes this objective on their next message`;

function parseDirectives(text: string): Directive[] | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const bare = fenced ? null : text.match(/(\[[\s\S]*\])/);
  const source = fenced?.[1] ?? bare?.[1];
  if (!source) return null;
  try {
    const raw = JSON.parse(source);
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw
      .map((item: unknown): Directive | null => {
        const record = (item ?? {}) as Record<string, unknown>;
        if (typeof record.tool !== "string") return null;
        return { tool: record.tool as LisaTool, args: (record.args ?? {}) as Record<string, unknown> };
      })
      .filter((d): d is Directive => d !== null);
  } catch {
    return null;
  }
}

function isCapabilityKey(value: unknown): value is AgentCapabilityKey {
  return typeof value === "string" && (AGENT_CAPABILITY_KEYS as readonly string[]).includes(value);
}

function needsCrossReview(task: Task, risk: "low" | "medium" | "high"): boolean {
  if (risk !== "low") return true;
  const scope = task.fileScope.join(" ");
  return SENSITIVE_SCOPE_PATTERNS.some((pattern) => pattern.test(scope));
}

async function unmetDependencies(dependsOnTaskIds: string[]): Promise<string[]> {
  if (!dependsOnTaskIds.length) return [];
  const deps = await db.task.findMany({ where: { id: { in: dependsOnTaskIds } }, select: { id: true, status: true } });
  return deps.filter((dep) => dep.status !== "COMPLETED").map((dep) => dep.id);
}

async function ensureApprovalCleared(roomId: string, task: Task): Promise<boolean> {
  const risk = assessRisk(`${task.title} ${task.description ?? ""} ${task.fileScope.join(" ")}`);
  if (!requiresApproval(risk)) return true;
  const decided = await db.approvalRequest.findFirst({ where: { taskId: task.id }, orderBy: { createdAt: "desc" } });
  if (decided?.status === "approved") return true;
  if (decided?.status === "pending") return false;
  const approval = await requestApprovalGate({
    chatRoomId: roomId, taskId: task.id, requesterAgentId: task.agentId ?? task.createdByAgentId ?? "hermes-lisa",
    title: `Approval required: ${task.title}`, description: task.description ?? undefined, command: task.title,
  });
  await setTaskStatus(task.id, "APPROVAL_REQUIRED");
  await emitCollaborationEvent(roomId, "approval.requested", { taskId: task.id, approvalId: approval.id, risk });
  return false;
}

async function reviewCycleCount(chatRoomId: string, taskId: string): Promise<number> {
  return db.collaborationEvent.count({ where: { chatRoomId, type: "task.review_failed", payload: { path: ["taskId"], equals: taskId } } });
}

async function runImplementation(ctx: LoopContext, task: Task): Promise<Record<string, unknown>> {
  const ownerAgentId = task.agentId!;
  await setTaskStatus(task.id, "RUNNING");
  await emitCollaborationEvent(ctx.roomId, "task.started", { taskId: task.id, agentId: ownerAgentId });

  const runtime = await resolveAgentRuntime(ownerAgentId);
  const worktree = await ensureTaskWorktree({ runtime, taskId: task.id, agentId: ownerAgentId }).catch((error) => {
    console.error("[lisa-loop] worktree setup failed, falling back to shared working directory", error);
    return null;
  });
  if (worktree) await db.task.update({ where: { id: task.id }, data: { branch: worktree.branch, worktreePath: worktree.path } });

  const lockPattern = task.fileScope[0] ?? `room:${ctx.roomId}/task:${task.id}/**`;
  const lock = await acquireExecutionLock({ chatRoomId: ctx.roomId, taskId: task.id, agentId: ownerAgentId, resourcePattern: lockPattern }).catch((error) => {
    console.error("[lisa-loop] execution lock conflict", error);
    return null;
  });

  try {
    const context = await buildAgentContext({ chatRoomId: ctx.roomId, taskId: task.id, agentId: ownerAgentId });
    const output = await runAgentTurn({ roomId: ctx.roomId, agentId: ownerAgentId, userId: ctx.userId, prompt: context, workingDirectory: worktree?.path });

    const artifact = await db.artifact.create({
      data: { type: "code_diff", title: `${ownerAgentId} result for ${task.id}`, content: output.slice(0, 20_000), createdBy: ownerAgentId, chatRoomId: ctx.roomId, taskId: task.id },
    });
    await emitCollaborationEvent(ctx.roomId, "artifact.created", { taskId: task.id, artifactId: artifact.id });
    await postCollaborationMessage({
      chatRoomId: ctx.roomId, senderAgentId: ownerAgentId, recipientAgentIds: ["user"], type: "RESULT", taskId: task.id, artifactIds: [artifact.id],
      content: output.slice(0, 4_000),
    });

    const risk = assessRisk(`${task.title} ${task.description ?? ""} ${task.fileScope.join(" ")}`);
    if (needsCrossReview(task, risk)) {
      await setTaskStatus(task.id, "WAITING_REVIEW");
      return { status: "WAITING_REVIEW", artifactId: artifact.id, summary: output.slice(0, 1_000), recommendation: "This task is risky or touches sensitive scope — consider calling requestReview before treating it as done." };
    }
    await setTaskStatus(task.id, "COMPLETED");
    await emitCollaborationEvent(ctx.roomId, "task.completed", { taskId: task.id, agentId: ownerAgentId });
    return { status: "COMPLETED", artifactId: artifact.id, summary: output.slice(0, 1_000) };
  } catch (error) {
    await setTaskStatus(task.id, "FAILED");
    await emitCollaborationEvent(ctx.roomId, "agent.failed", { taskId: task.id, error: error instanceof Error ? error.message : "Unknown error" });
    return { status: "FAILED", error: error instanceof Error ? error.message : "Unknown error" };
  } finally {
    if (lock) await releaseAgentLocks(ctx.roomId, ownerAgentId, task.id);
  }
}

async function executeDirective(ctx: LoopContext, directive: Directive): Promise<Record<string, unknown>> {
  const args = directive.args;
  switch (directive.tool) {
    case "createTask": {
      const title = typeof args.title === "string" ? args.title.slice(0, 200) : "";
      if (!title) return { error: "title is required" };
      const capabilities = Array.isArray(args.capabilities) ? args.capabilities.filter(isCapabilityKey) : [];
      const fileScope = Array.isArray(args.fileScope) ? args.fileScope.filter((f): f is string => typeof f === "string").slice(0, 20) : [];
      const dependsOnTaskIds = Array.isArray(args.dependsOnTaskIds) ? args.dependsOnTaskIds.filter((d): d is string => typeof d === "string") : [];
      const task = await createRoomTask({
        chatRoomId: ctx.roomId, title, description: typeof args.description === "string" ? args.description.slice(0, 2_000) : undefined,
        createdByAgentId: ctx.lead, capabilities, fileScope, dependsOnTaskIds,
      });
      await emitCollaborationEvent(ctx.roomId, "task.created", { taskId: task.id, title: task.title });
      return { taskId: task.id, status: task.status };
    }

    case "assignTask": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      const agentId = typeof args.agentId === "string" ? args.agentId : undefined;
      if (!taskId || !agentId) return { error: "taskId and agentId are required" };
      if (!ctx.pool.includes(agentId)) return { error: `${agentId} is not an implementation worker in this room` };
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return { error: "task not found" };
      const conflict = await findConflictingLock(ctx.roomId, agentId, task.fileScope);
      if (conflict) return { error: `Conflict: assigning ${agentId} would overlap "${conflict.resourcePattern}", currently locked by ${conflict.agentId}. Serialize, narrow the file scope, or hand off explicitly.` };
      await db.task.update({ where: { id: taskId }, data: { agentId, status: "QUEUED" } });
      await emitCollaborationEvent(ctx.roomId, "task.claimed", { taskId, agentId, reason: "assigned by Lisa" });
      return { taskId, agentId, status: "QUEUED" };
    }

    case "startTask": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      if (!taskId) return { error: "taskId is required" };
      let task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return { error: "task not found" };
      if (task.status === "COMPLETED" || task.status === "CANCELLED") return { error: `task already ${task.status}` };

      if (!task.agentId) {
        const selection = await selectWorker({ chatRoomId: ctx.roomId, requiredCapabilities: task.capabilities as AgentCapabilityKey[], candidates: ctx.pool, fileScope: task.fileScope });
        task = await db.task.update({ where: { id: taskId }, data: { agentId: selection.agentId, status: "QUEUED" } });
        await emitCollaborationEvent(ctx.roomId, "task.claimed", { taskId, agentId: selection.agentId, reason: selection.reason });
      }

      const unmet = await unmetDependencies(task.dependsOnTaskIds);
      if (unmet.length) return { error: `Blocked on incomplete dependencies: ${unmet.join(", ")}` };

      if (!(await ensureApprovalCleared(ctx.roomId, task))) {
        return { status: "APPROVAL_REQUIRED", message: "Awaiting human approval before this task can run. Move on to other work or ASK_USER if you're blocked on it." };
      }

      return runImplementation(ctx, task);
    }

    case "pauseTask": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      if (!taskId) return { error: "taskId is required" };
      await setTaskStatus(taskId, "BLOCKED");
      await emitCollaborationEvent(ctx.roomId, "task.blocked", { taskId, reason: "paused by Lisa" });
      return { taskId, status: "BLOCKED" };
    }

    case "cancelTask": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      if (!taskId) return { error: "taskId is required" };
      const task = await setTaskStatus(taskId, "CANCELLED");
      await emitCollaborationEvent(ctx.roomId, "execution.finished", { taskId, status: "cancelled" });
      return { taskId: task.id, status: "CANCELLED" };
    }

    case "reassignTask": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      const agentId = typeof args.agentId === "string" ? args.agentId : undefined;
      if (!taskId || !agentId) return { error: "taskId and agentId are required" };
      if (!ctx.pool.includes(agentId)) return { error: `${agentId} is not an implementation worker in this room` };
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return { error: "task not found" };
      if (task.agentId) await releaseAgentLocks(ctx.roomId, task.agentId, taskId);
      await db.task.update({ where: { id: taskId }, data: { agentId, status: "QUEUED" } });
      await emitCollaborationEvent(ctx.roomId, "task.claimed", { taskId, agentId, reassigned: true });
      return { taskId, agentId, status: "QUEUED" };
    }

    case "createDependency": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      const dependsOnTaskId = typeof args.dependsOnTaskId === "string" ? args.dependsOnTaskId : undefined;
      if (!taskId || !dependsOnTaskId) return { error: "taskId and dependsOnTaskId are required" };
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return { error: "task not found" };
      const dependsOnTaskIds = Array.from(new Set([...task.dependsOnTaskIds, dependsOnTaskId]));
      await db.task.update({ where: { id: taskId }, data: { dependsOnTaskIds } });
      return { taskId, dependsOnTaskIds };
    }

    case "requestReview": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      if (!taskId) return { error: "taskId is required" };
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return { error: "task not found" };
      if (!task.agentId) return { error: "task has no owner yet — startTask first" };

      const cycles = await reviewCycleCount(ctx.roomId, taskId);
      if (cycles >= MAX_REVIEW_CYCLES) {
        return { error: `Review budget exhausted (${cycles} rounds) for this task — reassign, accept as-is, or ASK_USER instead of requesting another review.` };
      }

      const explicitReviewer = typeof args.reviewerAgentId === "string" ? args.reviewerAgentId : undefined;
      const reviewerAgentId = explicitReviewer && ctx.pool.includes(explicitReviewer) ? explicitReviewer : ctx.pool.find((id) => id !== task.agentId);
      if (!reviewerAgentId) return { error: "no other worker is available to review this task" };

      await setTaskStatus(taskId, "WAITING_REVIEW");
      await db.task.update({ where: { id: taskId }, data: { reviewerAgentId } });
      await emitCollaborationEvent(ctx.roomId, "task.review_requested", { taskId, agentId: reviewerAgentId });

      const reviewContext = await buildAgentContext({
        chatRoomId: ctx.roomId, taskId, agentId: reviewerAgentId,
        extra: 'Review the implementation above. Reply with a first line of exactly "VERDICT: APPROVE" or "VERDICT: CHANGES_REQUESTED", followed by your reasoning.',
      });
      const reviewResult = await runAgentTurn({ roomId: ctx.roomId, agentId: reviewerAgentId, userId: ctx.userId, prompt: reviewContext });
      const approved = /VERDICT:\s*APPROVE/i.test(reviewResult) && !/VERDICT:\s*CHANGES_REQUESTED/i.test(reviewResult);

      if (approved) {
        await postCollaborationMessage({ chatRoomId: ctx.roomId, senderAgentId: reviewerAgentId, recipientAgentIds: [task.agentId], type: "RESULT", taskId, content: reviewResult.slice(0, 4_000) });
        await setTaskStatus(taskId, "COMPLETED");
        await emitCollaborationEvent(ctx.roomId, "task.completed", { taskId, agentId: task.agentId, reviewerAgentId });
        await db.decision.create({
          data: { title: `Completed: ${taskId}`, summary: `${task.agentId} implemented, ${reviewerAgentId} reviewed and approved.`, createdBy: reviewerAgentId, approvedBy: reviewerAgentId, chatRoomId: ctx.roomId, relatedTaskIds: [taskId] },
        });
        await emitCollaborationEvent(ctx.roomId, "decision.created", { taskId });
        return { verdict: "APPROVE", status: "COMPLETED", comments: reviewResult.slice(0, 1_000) };
      }

      await postCollaborationMessage({ chatRoomId: ctx.roomId, senderAgentId: reviewerAgentId, recipientAgentIds: [task.agentId], type: "CHANGES_REQUESTED", taskId, content: reviewResult.slice(0, 4_000) });
      await emitCollaborationEvent(ctx.roomId, "task.review_failed", { taskId, cycle: cycles + 1 });
      await setTaskStatus(taskId, "CHANGES_REQUESTED");
      return { verdict: "CHANGES_REQUESTED", status: "CHANGES_REQUESTED", comments: reviewResult.slice(0, 1_000), recommendation: "startTask again to have the owner address this feedback (it's already in their context), or reassign." };
    }

    case "requestValidation": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      if (!taskId) return { error: "taskId is required" };
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task?.agentId) return { error: "task not found or has no owner yet" };
      const context = await buildAgentContext({ chatRoomId: ctx.roomId, taskId, agentId: task.agentId, extra: "Self-check your latest work against the task's acceptance criteria. State clearly whether it's correct and complete, and what (if anything) is missing." });
      const result = await runAgentTurn({ roomId: ctx.roomId, agentId: task.agentId, userId: ctx.userId, prompt: context });
      await postCollaborationMessage({ chatRoomId: ctx.roomId, senderAgentId: task.agentId, recipientAgentIds: ["user"], type: "RESULT", taskId, content: result.slice(0, 4_000) });
      return { taskId, selfCheck: result.slice(0, 1_000) };
    }

    case "mergeTask": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      if (!taskId) return { error: "taskId is required" };
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return { error: "task not found" };
      if (task.status !== "COMPLETED") return { error: `task is ${task.status}, not COMPLETED — nothing to merge yet` };
      if (!task.branch || !task.agentId) return { error: "task has no worktree branch to merge" };
      const runtime = await resolveAgentRuntime(task.agentId);
      const result = await mergeTaskBranch(runtime, task.branch);
      if (!result.merged) return { merged: false, conflict: result.conflict };
      await emitCollaborationEvent(ctx.roomId, "decision.created", { taskId, merged: true });
      return { merged: true, branch: task.branch };
    }

    case "getTaskStatus": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      if (taskId) {
        const task = await db.task.findUnique({ where: { id: taskId } });
        return task ? { task: summarizeTask(task) } : { error: "task not found" };
      }
      const tasks = await db.task.findMany({ where: { chatRoomId: ctx.roomId }, orderBy: { createdAt: "asc" } });
      return { tasks: tasks.map(summarizeTask) };
    }

    case "getAgentStatus": {
      const statuses = await Promise.all(ctx.pool.map(async (agentId) => ({ agentId, activeTasks: await currentWorkload(ctx.roomId, agentId) })));
      return { agents: statuses };
    }

    case "getWorktreeStatus": {
      const taskId = typeof args.taskId === "string" ? args.taskId : undefined;
      if (!taskId) return { error: "taskId is required" };
      const task = await db.task.findUnique({ where: { id: taskId } });
      if (!task) return { error: "task not found" };
      const locks = await listActiveLocks(ctx.roomId);
      return { taskId, branch: task.branch, worktreePath: task.worktreePath, activeLock: locks.find((lock) => lock.taskId === taskId) ?? null };
    }

    case "getArtifact": {
      const artifactId = typeof args.artifactId === "string" ? args.artifactId : undefined;
      if (!artifactId) return { error: "artifactId is required" };
      const artifact = await db.artifact.findUnique({ where: { id: artifactId } });
      return artifact ? { artifact: { id: artifact.id, title: artifact.title, content: artifact.content?.slice(0, 4_000) } } : { error: "artifact not found" };
    }

    default:
      return { error: `Unknown tool: ${directive.tool}` };
  }
}

function summarizeTask(task: Task) {
  return { id: task.id, title: task.title, status: task.status, agentId: task.agentId, reviewerAgentId: task.reviewerAgentId, dependsOnTaskIds: task.dependsOnTaskIds };
}

export interface CompletionCheck {
  ok: boolean;
  reasons: string[];
}

/** The final acceptance gate — Sentinel, not Lisa's own claim, decides whether DONE actually holds. */
export async function validateCompletion(roomId: string): Promise<CompletionCheck> {
  const reasons: string[] = [];
  const tasks = await db.task.findMany({ where: { chatRoomId: roomId } });
  const unfinished = tasks.filter((task) => !["COMPLETED", "CANCELLED"].includes(task.status));
  if (unfinished.length) reasons.push(`${unfinished.length} task(s) not completed or cancelled: ${unfinished.map((t) => t.id).join(", ")}`);

  const pendingApprovals = await db.approvalRequest.count({ where: { chatRoomId: roomId, status: "pending" } });
  if (pendingApprovals) reasons.push(`${pendingApprovals} approval(s) still pending`);

  const unresolvedDisagreements = await db.agentDisagreement.count({ where: { chatRoomId: roomId, resolvedAt: null } });
  if (unresolvedDisagreements) reasons.push(`${unresolvedDisagreements} unresolved disagreement(s)`);

  const openLocks = await listActiveLocks(roomId);
  if (openLocks.length) reasons.push(`${openLocks.length} execution lock(s) still held`);

  return { ok: reasons.length === 0, reasons };
}

async function summarizeRoomTasks(roomId: string): Promise<string> {
  const tasks = await db.task.findMany({ where: { chatRoomId: roomId }, orderBy: { createdAt: "asc" } });
  if (!tasks.length) return "No tasks exist yet in this room.";
  return tasks.map((task) => `- ${task.id}: "${task.title}" status=${task.status} owner=${task.agentId ?? "unassigned"} dependsOn=[${task.dependsOnTaskIds.join(", ")}]`).join("\n");
}

function buildLoopPrompt(objective: string | null, pool: string[], workloads: Record<string, number>, taskSummary: string, body: string): string {
  return [
    "You are Hermes Lisa, the lead orchestrator for a Sentinel collaboration room.",
    objective ? `Room objective: ${objective}` : "",
    `Implementation workers available: ${pool.join(", ") || "none"}.`,
    `Current workload (active tasks): ${pool.map((id) => `${id}=${workloads[id] ?? 0}`).join(", ") || "n/a"}.`,
    // Every existing task and its real id, every turn — tool results only
    // carry the *previous* turn's outcomes, so without this a task created
    // several turns ago would become unreferenceable.
    `Current tasks in this room:\n${taskSummary}`,
    body,
    TOOL_MENU,
  ].filter(Boolean).join("\n\n");
}

async function finalizeObjective(roomId: string, lead: string, summary: string): Promise<void> {
  await postCollaborationMessage({ chatRoomId: roomId, senderAgentId: lead, recipientAgentIds: ["user"], type: "RESULT", content: summary.slice(0, 4_000) });
  await emitCollaborationEvent(roomId, "objective.completed", { summary: summary.slice(0, 500) });
}

export interface RunLisaLoopInput {
  roomId: string;
  userId: string;
  lead: string;
  pool: string[];
  objective: string | null;
  /** What kicks off (or resumes) this round of reasoning — the user's request the first time, a resumption note after an approval decision, etc. */
  seed: string;
}

/**
 * Lisa's actual tool-calling execution loop: she reasons over the current
 * state, calls one or more structured tools, sees the real results, and
 * decides what to do next — create more tasks, start them (in parallel
 * when independent), request review, recover from a failure, or claim
 * DONE (which Sentinel independently verifies before accepting). This
 * replaces the previous single-shot "plan once, then run a hardcoded
 * pipeline" orchestrator with something that genuinely continues until
 * the objective's acceptance criteria pass, bounded by
 * MAX_LISA_ITERATIONS so a stuck loop surfaces to the human instead of
 * spinning forever.
 */
export async function runLisaLoop(input: RunLisaLoopInput): Promise<void> {
  const ctx: LoopContext = { roomId: input.roomId, userId: input.userId, lead: input.lead, pool: input.pool };
  let body = input.seed;

  for (let iteration = 0; iteration < MAX_LISA_ITERATIONS; iteration += 1) {
    const room = await db.chatRoom.findUnique({ where: { id: input.roomId }, select: { paused: true } });
    if (room?.paused) {
      await emitCollaborationEvent(input.roomId, "agent.failed", { reason: "Room paused mid-orchestration" });
      return;
    }

    const workloads = Object.fromEntries(await Promise.all(ctx.pool.map(async (agentId) => [agentId, await currentWorkload(ctx.roomId, agentId)] as const)));
    const taskSummary = await summarizeRoomTasks(ctx.roomId);
    const responseText = await runAgentTurn({ roomId: ctx.roomId, agentId: ctx.lead, userId: ctx.userId, prompt: buildLoopPrompt(input.objective, ctx.pool, workloads, taskSummary, body) });

    const directives = parseDirectives(responseText);
    if (!directives || directives.length === 0) {
      await postCollaborationMessage({ chatRoomId: ctx.roomId, senderAgentId: ctx.lead, recipientAgentIds: ctx.pool, type: "MESSAGE", content: responseText.slice(0, 4_000) });
      return;
    }
    await postCollaborationMessage({ chatRoomId: ctx.roomId, senderAgentId: ctx.lead, recipientAgentIds: ctx.pool, type: "DELEGATION", content: responseText.slice(0, 4_000) });

    const askDirective = directives.find((d) => d.tool === "ASK_USER");
    const doneDirective = directives.find((d) => d.tool === "DONE");
    const otherDirectives = directives.filter((d) => d.tool !== "ASK_USER" && d.tool !== "DONE" && d.tool !== "startTask");
    const startDirectives = directives.filter((d) => d.tool === "startTask");

    const results: { tool: string; args: unknown; result: unknown }[] = [];
    for (const directive of otherDirectives) {
      const result = await executeDirective(ctx, directive).catch((error) => ({ error: error instanceof Error ? error.message : String(error) }));
      results.push({ tool: directive.tool, args: directive.args, result });
    }
    if (startDirectives.length) {
      const started = await Promise.all(startDirectives.map(async (directive) => ({
        tool: directive.tool, args: directive.args,
        result: await executeDirective(ctx, directive).catch((error) => ({ error: error instanceof Error ? error.message : String(error) })),
      })));
      results.push(...started);
    }

    if (askDirective) {
      const question = typeof askDirective.args.question === "string" ? askDirective.args.question : "What should I do next?";
      await postCollaborationMessage({ chatRoomId: ctx.roomId, senderAgentId: ctx.lead, recipientAgentIds: ["user"], type: "QUESTION", content: question });
      await emitCollaborationEvent(ctx.roomId, "agent.finished", { agentId: ctx.lead, awaitingUser: true });
      return;
    }

    if (doneDirective) {
      const summary = typeof doneDirective.args.summary === "string" ? doneDirective.args.summary : "Objective complete.";
      const check = await validateCompletion(ctx.roomId);
      if (check.ok) {
        await finalizeObjective(ctx.roomId, ctx.lead, summary);
        return;
      }
      results.push({ tool: "DONE", args: doneDirective.args, result: { accepted: false, reasons: check.reasons } });
    }

    body = `Tool results from your last turn:\n${JSON.stringify(results, null, 2)}\n\nContinue: call more tools, DONE once every acceptance criterion actually passes, or ASK_USER if you need human input.`;
  }

  await emitCollaborationEvent(input.roomId, "task.blocked", { reason: "lisa_loop_budget_exhausted" });
  await postCollaborationMessage({
    chatRoomId: input.roomId, senderAgentId: input.lead, recipientAgentIds: ["user"], type: "BLOCKER",
    content: "I've reached my orchestration step budget without completing the objective. Human input needed.",
  });
}
