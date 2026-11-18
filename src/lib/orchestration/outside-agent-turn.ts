import { db } from "@/lib/db";
import { sendToAgent, type A2aDialect } from "@/lib/collaboration/a2a/client";
import { requestOutsideJson, type OutsideTransport } from "@/lib/collaboration/a2a/http";
import { projectAgentToken } from "@/lib/collaboration/agent-token";
import { findConnectedOutsideAgent } from "@/lib/collaboration/project-agents";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { emitCollaborationEvent } from "./event-bus";
import { postCollaborationMessage } from "./messages";

const REPLY_MAX_CHARS = 4_000;

/** Tells the room, in nobody's name, that an agent did not answer. */
const notifyRoom = (roomId: string, content: string) =>
  db.message.create({ data: { chatRoomId: roomId, role: "system", content } });

/**
 * One turn for an agent a person brought into the project, which runs on
 * that person's own server. Sentinel sends it the one message addressed to it
 * and nothing else: no room history, no project memory, no files. Its answer
 * is posted as that agent's. If its server does not answer, the room is told
 * so in a notice of its own and nothing is written in the agent's name.
 */
export async function runOutsideAgentReply(
  input: { roomId: string; projectId: string | null; agentId: string; userId: string; userContent: string },
  transport: OutsideTransport = requestOutsideJson,
): Promise<void> {
  const agent = input.projectId ? await findConnectedOutsideAgent(input.projectId, input.agentId) : null;
  if (!agent || !agent.endpointUrl) {
    await notifyRoom(input.roomId, "That agent is not connected to this project, so it was not asked.");
    await emitCollaborationEvent(input.roomId, "agent.failed", { agentId: input.agentId, outside: true, error: "That agent is not connected to this project." });
    return;
  }

  await emitCollaborationEvent(input.roomId, "agent.started", { agentId: agent.agentId, direct: true, outside: true });
  await writeAuditLog({
    userId: input.userId, projectId: agent.projectId, action: "project_agent.message_sent", entityType: "projectAgent", entityId: agent.id,
    details: { agentId: agent.agentId, roomId: input.roomId, promptLength: input.userContent.length },
  });
  try {
    const reply = await sendToAgent({
      endpointUrl: agent.endpointUrl,
      dialect: (agent.protocolDialect === "0.3" ? "0.3" : "1.0") satisfies A2aDialect,
      token: projectAgentToken(agent.id, agent.tokenVersion),
      prompt: input.userContent,
    }, { transport });
    await postCollaborationMessage({
      chatRoomId: input.roomId, senderAgentId: agent.agentId, recipientAgentIds: ["user"], type: "ANSWER", content: reply.slice(0, REPLY_MAX_CHARS),
    });
    if (agent.lastError) await db.projectAgent.update({ where: { id: agent.id }, data: { lastError: null } });
    await emitCollaborationEvent(input.roomId, "agent.finished", { agentId: agent.agentId, direct: true, outside: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : "The agent did not answer.";
    await db.projectAgent.update({ where: { id: agent.id }, data: { lastError: message.slice(0, 300) } }).catch(() => undefined);
    await notifyRoom(input.roomId, `${agent.name ?? "The agent"} did not answer. ${message}`);
    await emitCollaborationEvent(input.roomId, "agent.failed", { agentId: agent.agentId, outside: true, error: message });
  }
}
