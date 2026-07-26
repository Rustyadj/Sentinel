// Sentinel Voice Gateway — shared routing logic between the Next.js app and
// the LiveKit Agents worker.
//
// A LiveKit room maps 1:1 to a Sentinel chat room (conversation): the room
// name is deterministic from roomId, and participant metadata carries the
// ids (agentId, workspaceId, roomId, userId) both sides need to route a
// turn to the right agent, memory scope, and persisted conversation —
// without either side inventing its own separate identity model.

export interface VoiceRouteContext {
  agentId: string;
  roomId: string;
  userId: string;
  workspaceId?: string;
}

/** Deterministic LiveKit room name for a Sentinel chat room. */
export function liveKitRoomName(roomId: string): string {
  return `sentinel-voice-${roomId}`;
}

/** Participant metadata attached to the LiveKit token — the worker reads this to route the turn. */
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
