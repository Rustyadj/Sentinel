import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { encodeParticipantMetadata, liveKitRoomName } from "@/lib/voice/gateway";

/**
 * POST /api/voice/token
 *
 * Mints a real, scoped LiveKit access token for a browser client to join the
 * voice session for one chat room. Real grants against a real room name
 * derived from roomId — no placeholder/dummy token, and fails closed (503)
 * if LiveKit isn't configured rather than handing back something that looks
 * like it should work.
 *
 * Participant metadata carries {agentId, roomId, userId} for observability
 * (visible in the LiveKit dashboard) only — the worker (a separate
 * deployment, see docs/voice/LIVEKIT_ARCHITECTURE.md) is stateless and never
 * reads it. It parses roomId back out of the room name it joined and lets
 * Sentinel's own /api/chat resolve the acting user and agent server-side.
 */
export async function POST(req: NextRequest) {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    return NextResponse.json(
      { error: "Voice (LiveKit) is not configured on this deployment" },
      { status: 503 },
    );
  }

  let body: { agentId?: string; roomId?: string };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }
  if (!body.agentId || !body.roomId) {
    return NextResponse.json({ error: "agentId and roomId are required" }, { status: 400 });
  }

  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const room = await db.chatRoom.findFirst({
    where: { id: body.roomId, userId: user.id },
    select: { id: true },
  });
  if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });

  const liveKitRoom = liveKitRoomName(room.id);
  const metadata = encodeParticipantMetadata({
    agentId: body.agentId,
    roomId: room.id,
    userId: user.id,
  });

  const token = new AccessToken(apiKey, apiSecret, {
    identity: user.id,
    name: user.name ?? user.email,
    metadata,
    ttl: "10m",
  });
  token.addGrant({
    room: liveKitRoom,
    roomJoin: true,
    canPublish: true,
    canSubscribe: true,
    canPublishData: true,
  });

  return NextResponse.json({
    url,
    token: await token.toJwt(),
    room: liveKitRoom,
  });
}
