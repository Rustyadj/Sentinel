// Sentinel Voice Gateway — shared routing logic between the Next.js app and
// the LiveKit Agents worker.
//
// A LiveKit room maps 1:1 to a Sentinel chat room (conversation): the room
// name is deterministic from roomId. That name is the ONLY identity the
// worker needs — it's stateless by design (audio in, turn detection, STT,
// stream text to Sentinel, receive streamed text back, TTS, audio out) and
// never decides an agentId, userId, or workspaceId itself. Sentinel derives
// who's speaking and which agent answers from the room record server-side
// (see resolveVoiceWorkerTurn() in src/app/api/chat/route.ts) — routing,
// memory, tools, and permissions all stay in Sentinel, not the worker.
//
// Participant metadata below is optional observability context (visible in
// the LiveKit dashboard) — it is never read by the worker to make a
// decision.

const ROOM_PREFIX = "sentinel-voice-";

export interface VoiceRouteContext {
  agentId: string;
  roomId: string;
  userId: string;
  workspaceId?: string;
}

/** Deterministic LiveKit room name for a Sentinel chat room. */
export function liveKitRoomName(roomId: string): string {
  return `${ROOM_PREFIX}${roomId}`;
}

/** Inverse of liveKitRoomName() — the only piece of identity the worker parses out for itself. */
export function roomIdFromLiveKitRoomName(name: string): string | null {
  return name.startsWith(ROOM_PREFIX) ? name.slice(ROOM_PREFIX.length) : null;
}

/** Optional observability metadata attached to the LiveKit token — not consumed by the worker. */
export function encodeParticipantMetadata(ctx: VoiceRouteContext): string {
  return JSON.stringify(ctx);
}

export function decodeParticipantMetadata(raw: string | undefined | null): VoiceRouteContext | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<VoiceRouteContext>;
    if (!parsed.agentId || !parsed.roomId || !parsed.userId) return null;
    return {
      agentId: parsed.agentId,
      roomId: parsed.roomId,
      userId: parsed.userId,
      workspaceId: parsed.workspaceId,
    };
  } catch {
    return null;
  }
}
