import { db } from "@/lib/db";
import { getVpsAgent } from "@/lib/agents/registry";
import { RUNTIME_AGENT_MAP, runtimeEventText } from "@/lib/agents/runtime/chat-routing";
import { requireRuntimeAccess, RUNTIME_PERMISSIONS } from "@/lib/agents/runtime/authorization";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";
import { ModelUnavailableError, isManagedWorkerKind } from "@/lib/agents/model-policy";
import { emitCollaborationEvent } from "./event-bus";
import { postCollaborationMessage } from "./messages";
import { ensureTaskWorktree } from "./worktree-manager";

export async function resolveAgentRuntime(agentId: string) {
  const route = RUNTIME_AGENT_MAP[agentId];
  if (!route) throw new Error(`No runtime route for agent ${agentId}`);
  const { runtime } = await requireRuntimeAccess(route.runtimeId, RUNTIME_PERMISSIONS.execute);
  return runtime;
}

/**
 * Runs one real turn for one agent (Lisa's own reasoning, or a worker's
 * implementation/review pass) through its actual runtime adapter — no
 * mocked output. A distinct AgentSession is kept per (room, runtime,
 * workingDirectory) so two parallel tasks for the same agent in the same
 * room, each in its own worktree, never share a process or cwd.
 */
export async function runAgentTurn(input: { roomId: string; agentId: string; userId: string; prompt: string; workingDirectory?: string }): Promise<string> {
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
    // The runtime rejected the requested model itself — surface this as a
    // distinguishable MODEL_UNAVAILABLE outcome, never as an ordinary
    // failure the caller might otherwise react to by quietly retrying.
    if (event.type === "error" && event.data.modelUnavailable === true && isManagedWorkerKind(runtime.kind)) {
      throw new ModelUnavailableError(
        runtime.kind,
        typeof event.data.requestedModel === "string" ? event.data.requestedModel : "unknown",
        (typeof event.data.requestedEffort === "string" ? event.data.requestedEffort : "high") as "low" | "medium" | "high",
        typeof event.data.reason === "string" ? event.data.reason : "Runtime rejected the requested model",
      );
    }
  }
  return fullContent;
}

/**
 * A direct @mention or Solo-mode reply bypasses Lisa's orchestration, but
 * never Sentinel's worktree enforcement: a write-capable coding runtime
 * (claude-code/codex) still never executes against the shared primary
 * working tree, even outside a Lisa-managed task. There's no Task row to
 * key a worktree off here, so it uses a synthetic per-room "direct"
 * session id instead — stable across repeated direct messages from the
 * same agent in the same room, isolated from every other room/task.
 */
async function ensureDirectWorkingDirectory(roomId: string, agentId: string): Promise<string | undefined> {
  const kind = getVpsAgent(agentId)?.kind;
  if (kind !== "claude-code" && kind !== "codex") return undefined;
  const runtime = await resolveAgentRuntime(agentId);
  const instance = asRuntimeInstance(runtime);
  const worktree = await ensureTaskWorktree({ runtime: instance, taskId: `direct-${roomId}`, agentId });
  return worktree.path;
}

export async function runDirectAgentReply(roomId: string, agentId: string, userId: string, userContent: string): Promise<void> {
  await emitCollaborationEvent(roomId, "agent.started", { agentId, direct: true });
  try {
    // If worktree setup itself fails, this throws and falls straight into
    // the catch below — execution is blocked, not silently retried against
    // the shared primary tree.
    const workingDirectory = await ensureDirectWorkingDirectory(roomId, agentId);
    const reply = await runAgentTurn({ roomId, agentId, userId, prompt: userContent, workingDirectory });
    await postCollaborationMessage({
      chatRoomId: roomId, senderAgentId: agentId, recipientAgentIds: ["user"], type: "ANSWER", content: reply.slice(0, 4_000),
    });
    await emitCollaborationEvent(roomId, "agent.finished", { agentId, direct: true });
  } catch (error) {
    await emitCollaborationEvent(roomId, "agent.failed", { agentId, error: error instanceof Error ? error.message : "Unknown error" });
  }
}
