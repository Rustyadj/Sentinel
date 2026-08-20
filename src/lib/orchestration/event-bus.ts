import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { CollaborationEventType } from "@/types/collaboration";

function asJson(value: unknown): Prisma.InputJsonValue {
  return (value ?? {}) as Prisma.InputJsonValue;
}

/**
 * Appends one CollaborationEvent with a room-scoped, gap-free sequence
 * number. Uses the same advisory-lock-per-room pattern as
 * agents/runtime/delegation.ts's session event append, so concurrent
 * writers in the same room can't race each other onto the same sequence.
 */
export async function emitCollaborationEvent(
  chatRoomId: string,
  type: CollaborationEventType,
  payload: Record<string, unknown> = {},
) {
  return db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`collab-event:${chatRoomId}`}))`;
    const aggregate = await tx.collaborationEvent.aggregate({
      where: { chatRoomId },
      _max: { sequence: true },
    });
    return tx.collaborationEvent.create({
      data: {
        chatRoomId,
        sequence: (aggregate._max.sequence ?? 0) + 1,
        type,
        payload: asJson(payload),
      },
    });
  });
}

export async function listCollaborationEventsSince(chatRoomId: string, afterSequence = 0, limit = 200) {
  return db.collaborationEvent.findMany({
    where: { chatRoomId, sequence: { gt: afterSequence } },
    orderBy: { sequence: "asc" },
    take: limit,
  });
}
