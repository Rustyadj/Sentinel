import { db } from "@/lib/db";

const PHONE_ROOM_NAME = "Phone";

/**
 * The chat room a user's phone traffic with one agent is recorded in. Using an
 * ordinary ChatRoom is the point: call turns then flow through the same
 * runtime, history and memory path as typed chat, so the agent that spoke on
 * the phone is the agent that remembers it.
 */
export async function ensurePhoneRoom(userId: string, agentId: string): Promise<string> {
  const existing = await db.chatRoom.findFirst({
    where: { userId, name: PHONE_ROOM_NAME, agentIds: { has: agentId } },
    select: { id: true },
  });
  if (existing) return existing.id;
  const created = await db.chatRoom.create({
    data: { userId, name: PHONE_ROOM_NAME, agentIds: [agentId], mode: "solo", autonomyLevel: "assisted" },
    select: { id: true },
  });
  return created.id;
}
