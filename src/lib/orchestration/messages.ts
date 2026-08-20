import { db } from "@/lib/db";
import type { AgentMessageType } from "@/types/collaboration";

export interface PostMessageInput {
  chatRoomId: string;
  senderAgentId: string | "user";
  recipientAgentIds: string[];
  type: AgentMessageType;
  content: string;
  taskId?: string;
  artifactIds?: string[];
}

export async function postCollaborationMessage(input: PostMessageInput) {
  return db.message.create({
    data: {
      chatRoomId: input.chatRoomId,
      role: input.senderAgentId === "user" ? "user" : "agent",
      agentId: input.senderAgentId === "user" ? null : input.senderAgentId,
      content: input.content,
      messageType: input.type,
      recipientAgentIds: input.recipientAgentIds,
      taskId: input.taskId,
      artifactIds: input.artifactIds ?? [],
    },
  });
}
