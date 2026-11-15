import { db } from "@/lib/db";
import { emitEvent } from "@/lib/knowledge/events";
import { requireRoomAccess } from "@/lib/orchestration/access";

export async function persistChatExchange(params: {
  roomId: string;
  userId: string;
  userContent: string;
  agentId: string;
  assistantContent: string;
  provenance?: {
    runtimeKind?: string;
    provider?: string;
    model?: string;
    agentRuntimeSessionId?: string;
  };
}) {
  // Write access, not ownership: a project member's exchange in a shared room is saved too.
  const room = await requireRoomAccess(params.roomId, params.userId).catch(() => null);
  if (!room) throw new Error("Room not found");

  await db.message.createMany({
    data: [
      { chatRoomId: room.id, role: "user", content: params.userContent, authorUserId: params.userId },
      {
        chatRoomId: room.id,
        role: "agent",
        agentId: params.agentId,
        content: params.assistantContent,
        runtimeKind: params.provenance?.runtimeKind,
        provider: params.provenance?.provider,
        model: params.provenance?.model,
        agentRuntimeSessionId: params.provenance?.agentRuntimeSessionId,
      },
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
