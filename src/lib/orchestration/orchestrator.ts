import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";
import { RUNTIME_AGENT_MAP, runtimeEventText } from "@/lib/agents/runtime/chat-routing";
import { requireRuntimeAccess, RUNTIME_PERMISSIONS } from "@/lib/agents/runtime/authorization";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";
import { assessRisk, requestApprovalGate, requiresApproval } from "./approval-gate";
import { type AgentCapabilityKey, AGENT_CAPABILITY_KEYS, resolveLead, resolveWorkerPool } from "./capabilities";
import { buildAgentContext } from "./context-builder";
import { emitCollaborationEvent } from "./event-bus";
import { acquireExecutionLock, releaseAgentLocks } from "./execution-lock";
import { postCollaborationMessage } from "./messages";
import { createRoomTask, setTaskStatus } from "./task-router";
import { currentWorkload, selectWorker } from "./worker-router";
import { ensureTaskWorktree } from "./worktree-manager";
import type { Task } from "@prisma/client";

const MAX_REVIEW_CYCLES = 3;
/** Sensitive scope where a risk-based cross-review is warranted regardless of the risk-keyword check on the task text itself. */
const SENSITIVE_SCOPE_PATTERNS = [/prisma\/schema\.prisma/i, /agents\/runtime\//i, /auth\.ts$/i, /migrations\//i];

export interface RunCollaborationInput {
  chatRoomId: string;
  userId: string;
  userContent: string;
  /** When exactly one recipient is given, this is a direct @mention: reply
   *  from that agent alone rather than running the full plan/dispatch flow. */
  recipientAgentIds?: string[];
}

interface PlannedTaskDraft {
  title: string;
  description?: string;
  capabilities: AgentCapabilityKey[];
  fileScope: string[];
  dependsOn: number[];
}

function buildPlanningPrompt(objective: string | null, userContent: string, pool: string[], workloads: Record<string, number>): string {
  return [
    "You are Hermes Lisa, the lead orchestrator for a Sentinel collaboration room.",
    objective ? `Room objective: ${objective}` : "",
    `User request: ${userContent}`,
    `Available implementation workers: ${pool.join(", ") || "none"}.`,
    `Current workload (active tasks): ${pool.map((id) => `${id}=${workloads[id] ?? 0}`).join(", ") || "n/a"}.`,
    "Break this request into a small number of concrete, independently-ownable tasks.",
    "Prefer clean file/module ownership boundaries over splitting one file between two workers.",
    "Any worker may implement, debug, test, refactor, or research — do not assume one worker only reviews.",
    "Respond with ONLY a fenced json code block containing an array of objects shaped exactly as:",
    '{"title": string, "description": string, "capabilities": string[] (from: ' + AGENT_CAPABILITY_KEYS.join(", ") + '), "fileScope": string[] (glob patterns), "dependsOn": number[] (0-based indices into this same array)}',
  ].filter(Boolean).join("\n");
}

function parsePlan(text: string): PlannedTaskDraft[] | null {
  const fenced = text.match(/```json\s*([\s\S]*?)```/i);
  const bare = fenced ? null : text.match(/(\[[\s\S]*\])/);
  const source = fenced?.[1] ?? bare?.[1];
  if (!source) return null;
  try {
    const raw = JSON.parse(source);
    if (!Array.isArray(raw) || raw.length === 0) return null;
    return raw.map((item: unknown): PlannedTaskDraft => {
      const record = (item ?? {}) as Record<string, unknown>;
      return {
        title: (typeof record.title === "string" ? record.title : "").slice(0, 200) || "Untitled task",
        description: typeof record.description === "string" ? record.description.slice(0, 2_000) : undefined,
        capabilities: Array.isArray(record.capabilities)
          ? record.capabilities.filter((c): c is AgentCapabilityKey => typeof c === "string" && (AGENT_CAPABILITY_KEYS as readonly string[]).includes(c))
          : [],
        fileScope: Array.isArray(record.fileScope) ? record.fileScope.filter((f): f is string => typeof f === "string").slice(0, 20) : [],
        dependsOn: Array.isArray(record.dependsOn) ? record.dependsOn.filter((d): d is number => typeof d === "number") : [],
      };
    });
  } catch {
    return null;
  }
}

function needsCrossReview(task: Task, risk: "low" | "medium" | "high"): boolean {
  if (risk !== "low") return true;
  const scope = task.fileScope.join(" ");
  return SENSITIVE_SCOPE_PATTERNS.some((pattern) => pattern.test(scope));
}

async function resolveAgentRuntime(agentId: string) {
  const route = RUNTIME_AGENT_MAP[agentId];
  if (!route) throw new Error(`No runtime route for agent ${agentId}`);
  const { runtime } = await requireRuntimeAccess(route.runtimeId, RUNTIME_PERMISSIONS.execute);
  return runtime;
}

async function runAgentTurn(input: { roomId: string; agentId: string; userId: string; prompt: string; workingDirectory?: string }): Promise<string> {
  const runtime = await resolveAgentRuntime(input.agentId);
  const adapter = getRuntimeAdapter(runtime.kind);
  const instance = asRuntimeInstance(runtime);
  const readiness = await adapter.readiness(instance);
  if (!readiness.ready) throw new Error(`Runtime unavailable: ${readiness.reason ?? "not ready"}`);

  let session = await db.agentSession.findFirst({
    where: {
      runtimeInstanceId: runtime.id,
      userId: input.userId,
      chatRoomId: input.roomId,
      status: { notIn: ["running", "cancelled", "timed_out"] },
      ...(input.workingDirectory ? { workingDirectory: input.workingDirectory } : {}),
    },
    orderBy: { lastActivityAt: "desc" },
  });
  if (!session) {
    const created = await adapter.startSession({
      runtimeId: runtime.id,
      userId: input.userId,
      workspaceId: runtime.workspaceId,
      workingDirectory: input.workingDirectory,
    });
    session = await db.agentSession.update({ where: { id: created.id }, data: { chatRoomId: input.roomId } });
  }

  let fullContent = "";
  for await (const event of adapter.send({ sessionId: session.id, prompt: input.prompt, userId: input.userId })) {
    const text = runtimeEventText(event);
    if (text) fullContent += text;
  }
  return fullContent;
}

async function runDirectAgentReply(roomId: string, agentId: string, userId: string, userContent: string): Promise<void> {
  await emitCollaborationEvent(roomId, "agent.started", { agentId, direct: true });
  try {
    const reply = await runAgentTurn({ roomId, agentId, userId, prompt: userContent });
    await postCollaborationMessage({
      chatRoomId: roomId, senderAgentId: agentId, recipientAgentIds: ["user"], type: "ANSWER", content: reply.slice(0, 4_000),
    });
    await emitCollaborationEvent(roomId, "agent.finished", { agentId, direct: true });
  } catch (error) {
    await emitCollaborationEvent(roomId, "agent.failed", { agentId, error: error instanceof Error ? error.message : "Unknown error" });
  }
}

/**
 * Runs one Lisa-led turn: she reasons over the request (a real LLM call,
 * not a scripted template) to decompose it into an explicit task DAG,
 * the worker-router assigns each task to whichever of Claude Code/Codex
 * scores best (never a fixed split), independent tasks dispatch in
 * parallel, and risk-based cross-review only happens where it's actually
 * warranted. Runs fire-and-forget from the API route (this app is a
 * long-running `next start` server behind Traefik, not serverless, so a
 * background promise the request doesn't await keeps running); progress
 * is visible entirely through the persisted messages/tasks/events the
 * room's SSE stream picks up.
 */
export async function runCollaborationTurn(input: RunCollaborationInput): Promise<void> {
  const room = await db.chatRoom.findFirstOrThrow({ where: { id: input.chatRoomId, userId: input.userId } });
  const lead = resolveLead(room.agentIds);
  const pool = resolveWorkerPool(room.agentIds);

  await postCollaborationMessage({
    chatRoomId: room.id, senderAgentId: "user", recipientAgentIds: lead ? [lead] : [], type: "MESSAGE", content: input.userContent,
  });

  if (room.paused) {
    await emitCollaborationEvent(room.id, "agent.failed", { reason: "Room is paused; message recorded but no task was started" });
    return;
  }

  if (input.recipientAgentIds?.length === 1 && getVpsAgent(input.recipientAgentIds[0])) {
    await runDirectAgentReply(room.id, input.recipientAgentIds[0], input.userId, input.userContent);
    return;
  }

  if (!lead || pool.length === 0) {
    await emitCollaborationEvent(room.id, "agent.failed", { reason: "Room has no lead agent or implementation workers configured" });
    return;
  }

  await planAndDispatch(room.id, room.objective, lead, pool, input.userId, input.userContent);
}

async function planAndDispatch(roomId: string, objective: string | null, lead: string, pool: string[], userId: string, userContent: string): Promise<void> {
  const workloads: Record<string, number> = {};
  for (const agentId of pool) workloads[agentId] = await currentWorkload(roomId, agentId);

  const planText = await runAgentTurn({ roomId, agentId: lead, userId, prompt: buildPlanningPrompt(objective, userContent, pool, workloads) });
  await postCollaborationMessage({ chatRoomId: roomId, senderAgentId: lead, recipientAgentIds: pool, type: "DELEGATION", content: planText.slice(0, 4_000) });

  const drafts = parsePlan(planText) ?? [{ title: userContent.slice(0, 120), description: userContent, capabilities: [], fileScope: [], dependsOn: [] }];

  const created: { id: string; draft: PlannedTaskDraft }[] = [];
  for (const draft of drafts) {
    const task = await createRoomTask({
      chatRoomId: roomId, title: draft.title, description: draft.description, createdByAgentId: lead,
      capabilities: draft.capabilities, fileScope: draft.fileScope,
    });
    created.push({ id: task.id, draft });
    await emitCollaborationEvent(roomId, "task.created", { taskId: task.id, title: task.title });
  }
  for (const { id, draft } of created) {
    const dependsOnTaskIds = draft.dependsOn.map((i) => created[i]?.id).filter((v): v is string => Boolean(v) && v !== id);
    if (dependsOnTaskIds.length) await db.task.update({ where: { id }, data: { dependsOnTaskIds } });
  }

  const taskIds = created.map((c) => c.id);
  await runDispatchLoop(roomId, userId, pool, lead, taskIds);
  await maybeCreateIntegrationTask(roomId, userId, pool, lead, taskIds);
}

async function tasksReadyToDispatch(taskIds: string[]): Promise<Task[]> {
  const tasks = await db.task.findMany({ where: { id: { in: taskIds } } });
  // Dependencies can point outside this batch (e.g. an integration task
  // depending on tasks from an earlier planning round), so their status
  // has to be looked up independently rather than assumed to be in `tasks`.
  const allDepIds = Array.from(new Set(tasks.flatMap((task) => task.dependsOnTaskIds)));
  const deps = allDepIds.length ? await db.task.findMany({ where: { id: { in: allDepIds } }, select: { id: true, status: true } }) : [];
  const depStatus = new Map(deps.map((dep) => [dep.id, dep.status]));
  return tasks.filter((task) => {
    if (task.status !== "PLANNED") return false;
    return task.dependsOnTaskIds.every((depId) => depStatus.get(depId) === "COMPLETED");
  });
}

async function runDispatchLoop(roomId: string, userId: string, pool: string[], lead: string, taskIds: string[]): Promise<void> {
  for (;;) {
    const ready = await tasksReadyToDispatch(taskIds);
    if (ready.length === 0) return;
    await Promise.all(ready.map((task) => dispatchTask(roomId, task.id, userId, pool, lead)));
  }
}

async function maybeCreateIntegrationTask(roomId: string, userId: string, pool: string[], lead: string, taskIds: string[]): Promise<void> {
  const tasks = await db.task.findMany({ where: { id: { in: taskIds } } });
  const completed = tasks.filter((task) => task.status === "COMPLETED");
  const distinctOwners = new Set(completed.map((task) => task.agentId).filter(Boolean));
  if (completed.length < 2 || distinctOwners.size < 2) return;

  const task = await createRoomTask({
    chatRoomId: roomId,
    title: "Integrate parallel work",
    description: `Reconcile the results of: ${completed.map((t) => t.title).join(", ")}`,
    createdByAgentId: lead,
    dependsOnTaskIds: completed.map((t) => t.id),
    capabilities: ["architecture"],
  });
  await emitCollaborationEvent(roomId, "task.created", { taskId: task.id, title: task.title, integration: true });
  await runDispatchLoop(roomId, userId, pool, lead, [task.id]);
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

async function dispatchTask(roomId: string, taskId: string, userId: string, pool: string[], lead: string): Promise<void> {
  let task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (["COMPLETED", "CANCELLED", "FAILED"].includes(task.status)) return;

  const room = await db.chatRoom.findUniqueOrThrow({ where: { id: roomId } });
  if (room.paused) {
    await emitCollaborationEvent(roomId, "task.blocked", { taskId, reason: "room_paused" });
    return;
  }

  if (!task.agentId) {
    const selection = await selectWorker({
      chatRoomId: roomId,
      requiredCapabilities: task.capabilities as AgentCapabilityKey[],
      candidates: pool,
      fileScope: task.fileScope,
    });
    task = await db.task.update({ where: { id: taskId }, data: { agentId: selection.agentId, status: "QUEUED" } });
    await emitCollaborationEvent(roomId, "task.claimed", { taskId, agentId: selection.agentId, reason: selection.reason });
    await postCollaborationMessage({
      chatRoomId: roomId, senderAgentId: lead, recipientAgentIds: [selection.agentId], type: "DELEGATION", taskId,
      content: `Assigning "${task.title}" to ${selection.agentId}. ${selection.reason}`,
    });
  }

  if (!(await ensureApprovalCleared(roomId, task))) return;

  await runWorkerImplementation(roomId, task, pool, userId);
}

async function runWorkerImplementation(roomId: string, initialTask: Task, pool: string[], userId: string): Promise<void> {
  const taskId = initialTask.id;
  const ownerAgentId = initialTask.agentId!;
  await setTaskStatus(taskId, "RUNNING");
  await emitCollaborationEvent(roomId, "task.started", { taskId, agentId: ownerAgentId });

  const runtime = await resolveAgentRuntime(ownerAgentId);
  const worktree = await ensureTaskWorktree({ runtime, taskId, agentId: ownerAgentId }).catch((error) => {
    console.error("[orchestrator] worktree setup failed, falling back to shared working directory", error);
    return null;
  });
  if (worktree) {
    await db.task.update({ where: { id: taskId }, data: { branch: worktree.branch, worktreePath: worktree.path } });
  }

  const lockPattern = initialTask.fileScope[0] ?? `room:${roomId}/task:${taskId}/**`;
  const lock = await acquireExecutionLock({ chatRoomId: roomId, taskId, agentId: ownerAgentId, resourcePattern: lockPattern }).catch((error) => {
    console.error("[orchestrator] execution lock conflict", error);
    return null;
  });

  let cycles = 0;
  try {
    let feedback = "";
    for (;;) {
      const room = await db.chatRoom.findUnique({ where: { id: roomId }, select: { paused: true } });
      if (room?.paused) {
        await setTaskStatus(taskId, "BLOCKED");
        await emitCollaborationEvent(roomId, "task.blocked", { taskId, reason: "room_paused" });
        return;
      }

      const context = await buildAgentContext({
        chatRoomId: roomId, taskId, agentId: ownerAgentId,
        extra: feedback ? `Reviewer feedback to address:\n${feedback}` : undefined,
      });
      const implementationResult = await runAgentTurn({ roomId, agentId: ownerAgentId, userId, prompt: context, workingDirectory: worktree?.path });

      const artifact = await db.artifact.create({
        data: { type: "code_diff", title: `${ownerAgentId} result for ${taskId}`, content: implementationResult.slice(0, 20_000), createdBy: ownerAgentId, chatRoomId: roomId, taskId },
      });
      await emitCollaborationEvent(roomId, "artifact.created", { taskId, artifactId: artifact.id });
      await postCollaborationMessage({
        chatRoomId: roomId, senderAgentId: ownerAgentId, recipientAgentIds: ["user"], type: "RESULT", taskId, artifactIds: [artifact.id],
        content: implementationResult.slice(0, 4_000),
      });

      const risk = assessRisk(`${initialTask.title} ${initialTask.description ?? ""} ${initialTask.fileScope.join(" ")}`);
      const reviewerId = pool.find((id) => id !== ownerAgentId);
      if (!reviewerId || !needsCrossReview(initialTask, risk)) {
        await completeTask(roomId, taskId, ownerAgentId, undefined);
        return;
      }

      await setTaskStatus(taskId, "WAITING_REVIEW");
      await db.task.update({ where: { id: taskId }, data: { reviewerAgentId: reviewerId } });
      await emitCollaborationEvent(roomId, "task.review_requested", { taskId, agentId: reviewerId });

      const reviewContext = await buildAgentContext({
        chatRoomId: roomId, taskId, agentId: reviewerId,
        extra: 'Review the implementation above. Reply with a first line of exactly "VERDICT: APPROVE" or "VERDICT: CHANGES_REQUESTED", followed by your reasoning.',
      });
      const reviewResult = await runAgentTurn({ roomId, agentId: reviewerId, userId, prompt: reviewContext });
      const approved = /VERDICT:\s*APPROVE/i.test(reviewResult) && !/VERDICT:\s*CHANGES_REQUESTED/i.test(reviewResult);

      if (approved) {
        await postCollaborationMessage({ chatRoomId: roomId, senderAgentId: reviewerId, recipientAgentIds: [ownerAgentId], type: "RESULT", taskId, content: reviewResult.slice(0, 4_000) });
        await completeTask(roomId, taskId, ownerAgentId, reviewerId);
        return;
      }

      await postCollaborationMessage({ chatRoomId: roomId, senderAgentId: reviewerId, recipientAgentIds: [ownerAgentId], type: "CHANGES_REQUESTED", taskId, content: reviewResult.slice(0, 4_000) });
      await emitCollaborationEvent(roomId, "task.review_failed", { taskId, cycle: cycles });
      await setTaskStatus(taskId, "CHANGES_REQUESTED");
      feedback = reviewResult;
      cycles += 1;
      if (cycles > MAX_REVIEW_CYCLES) {
        await setTaskStatus(taskId, "BLOCKED");
        await emitCollaborationEvent(roomId, "task.blocked", { taskId, reason: "max_review_cycles_reached" });
        await db.agentDisagreement.create({
          data: {
            chatRoomId: roomId, taskId,
            issue: `${ownerAgentId} and ${reviewerId} could not converge after ${MAX_REVIEW_CYCLES} review cycles`,
            positions: [
              { agentId: ownerAgentId, position: "Believes the latest revision addresses the requested changes." },
              { agentId: reviewerId, position: "Still has unresolved concerns about the implementation." },
            ],
            severity: "high",
          },
        });
        return;
      }
    }
  } catch (error) {
    await setTaskStatus(taskId, "FAILED");
    await emitCollaborationEvent(roomId, "agent.failed", { taskId, error: error instanceof Error ? error.message : "Unknown error" });
  } finally {
    if (lock) await releaseAgentLocks(roomId, ownerAgentId, taskId);
  }
}

async function completeTask(roomId: string, taskId: string, ownerAgentId: string, reviewerAgentId: string | undefined): Promise<void> {
  await setTaskStatus(taskId, "COMPLETED");
  await emitCollaborationEvent(roomId, "task.completed", { taskId, agentId: ownerAgentId, reviewerAgentId });
  if (reviewerAgentId) {
    await db.decision.create({
      data: { title: `Completed: ${taskId}`, summary: `${ownerAgentId} implemented, ${reviewerAgentId} reviewed and approved.`, createdBy: reviewerAgentId, approvedBy: reviewerAgentId, chatRoomId: roomId, relatedTaskIds: [taskId] },
    });
    await emitCollaborationEvent(roomId, "decision.created", { taskId });
  }
}

export async function resumeAfterApproval(taskId: string): Promise<void> {
  const task = await db.task.findUniqueOrThrow({ where: { id: taskId } });
  if (!task.chatRoomId) return;
  const room = await db.chatRoom.findUniqueOrThrow({ where: { id: task.chatRoomId } });
  if (!room.userId) return;
  const lead = resolveLead(room.agentIds);
  const pool = resolveWorkerPool(room.agentIds);
  if (!lead) return;
  await emitCollaborationEvent(room.id, "approval.granted", { taskId });
  await dispatchTask(room.id, taskId, room.userId, pool, lead);
}
