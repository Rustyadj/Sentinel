import { db } from "@/lib/db";
import { RUNTIME_AGENT_MAP, runtimeEventText } from "@/lib/agents/runtime/chat-routing";
import { requireRuntimeAccess, RUNTIME_PERMISSIONS } from "@/lib/agents/runtime/authorization";
import { asRuntimeInstance } from "@/lib/agents/runtime/config";
import { getRuntimeAdapter } from "@/lib/agents/runtime/service";
import { emitCollaborationEvent } from "./event-bus";
import { postCollaborationMessage } from "./messages";

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
  }
  return fullContent;
}

export async function runDirectAgentReply(roomId: string, agentId: string, userId: string, userContent: string): Promise<void> {
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
