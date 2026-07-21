import { db } from "@/lib/db";
import { emitEvent } from "@/lib/knowledge/events";

export async function persistChatExchange(params: {
  roomId: string;
  userId: string;
  userContent: string;
  agentId: string;
  assistantContent: string;
}) {
  const room = await db.chatRoom.findFirst({
    where: { id: params.roomId, userId: params.userId },
    select: { id: true, projectId: true },
  });
  if (!room) throw new Error("Room not found");

  await db.message.createMany({
    data: [
      { chatRoomId: room.id, role: "user", content: params.userContent },
      { chatRoomId: room.id, role: "agent", agentId: params.agentId, content: params.assistantContent },
    ],
  });
  await emitEvent({
    userId: params.userId,
    type: "object_created",
    payload: { roomId: room.id, agentId: params.agentId, messageCount: 2, trigger: "chat_response" },
    roomId: room.id,
    projectId: room.projectId ?? undefined,
  }).catch(() => undefined);
}
