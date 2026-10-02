import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { liveSessionInstructions, resolveAgentVoiceConfig } from "@/lib/voice/agent-voice-config";
import { startVoiceSessionTelemetry } from "@/lib/voice/telemetry";
import { warmRuntimeChat } from "@/lib/agents/runtime/chat-routing";
import { warmSystemOne } from "@/lib/system-one/turn";

export const runtime = "nodejs";

interface SessionRequestBody {
  agentId?: string;
  roomId?: string;
  language?: string;
  /** The browser's WebRTC offer; this route exchanges it for the answer with the project key. */
  sdp?: string;
}

/** An SDP offer is a few KB; anything near this is not one. */
const MAX_SDP_BYTES = 64 * 1024;

interface LiveSessionPayload {
  session?: { id?: string };
  transport?: { sdp?: string };
  error?: { message?: string };
}

export async function POST(req: NextRequest) {
  const apiKey = process.env.OPENAI_API_KEY?.trim();
  if (!apiKey) {
    return NextResponse.json(
      { error: "The live voice layer is not configured on this deployment" },
      { status: 503 },
    );
  }

  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: SessionRequestBody;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
  }

  if (typeof body.sdp !== "string" || !body.sdp.trim() || body.sdp.length > MAX_SDP_BYTES) {
    return NextResponse.json({ error: "A WebRTC offer is required" }, { status: 400 });
  }

  // Refuses an absent or unknown agentId rather than defaulting to one — the
  // caller must say who is speaking.
  const config = resolveAgentVoiceConfig(body.agentId);
  if (!config) {
    return NextResponse.json(
      { error: "Live voice is enabled only for Hermes Lisa and Hermes Nathan2, and the agent must be named explicitly" },
      { status: 400 },
    );
  }

  // The room must belong to this user *and* to this agent. Checking ownership
  // alone let a caller open a session in one agent's room while wearing the
  // other's voice and instructions, which is precisely the bleed the two are
  // meant to be isolated against.
  if (body.roomId) {
    const room = await db.chatRoom.findFirst({
      where: { id: body.roomId, userId: user.id },
      select: { id: true, agentIds: true },
    });
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
    if (!room.agentIds?.includes(config.agentId)) {
      return NextResponse.json(
        { error: "That conversation does not belong to this agent" },
        { status: 403 },
      );
    }
  }

  const language = body.language?.trim().slice(0, 35);
  const instructions = [
    liveSessionInstructions(config),
    language ? `The user's preferred language is ${language}.` : "",
  ]
    .filter(Boolean)
    .join("\n\n");

  // GPT-Live (/v1/live/sessions), not the Realtime API: the GPT-Live voices
  // (gleam, meridian, …) do not exist on /v1/realtime. There is no ephemeral
  // token here — the offer is exchanged server-side, so the project key never
  // reaches the browser. Delegation is "client": every substantive turn comes
  // back to Sentinel, which runs it on the agent's own brain.
  const openAIResponse = await fetch("https://api.openai.com/v1/live/sessions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": createHash("sha256").update(user.id).digest("hex"),
    },
    body: JSON.stringify({
      session: {
        model: config.voiceModel,
        instructions,
        audio: { output: { voice: config.voice } },
        delegation: { type: "client" },
      },
      transport: { type: "webrtc", sdp: body.sdp },
    }),
    cache: "no-store",
  });

  const payload = (await openAIResponse.json().catch(() => null)) as LiveSessionPayload | null;
  const answer = payload?.transport?.sdp;

  if (!openAIResponse.ok || !answer) {
    const detail = payload?.error?.message?.slice(0, 240);
    return NextResponse.json(
      { error: detail || "The live voice provider could not create a session" },
      { status: openAIResponse.status >= 400 && openAIResponse.status < 500 ? 502 : 503 },
    );
  }

  // Warm the agent's runtime, read-only tools and System 1 connection while
  // the browser finishes connecting, so the first spoken turn does not
  // pay for it. Fire-and-forget: none of it can fail the session.
  void warmRuntimeChat(config.agentId).catch(() => false);
  void warmSystemOne(config.agentId).catch(() => undefined);

  const sessionId = await startVoiceSessionTelemetry({
    userId: user.id,
    agentId: config.agentId,
    roomId: body.roomId ?? null,
    voiceModel: config.voiceModel,
    reasoningModel: config.reasoningModel,
  }).catch(() => null);

  return NextResponse.json({
    sdp: answer,
    sessionId,
    agentId: config.agentId,
    voice: config.voice,
    voiceModel: config.voiceModel,
    reasoningModel: config.reasoningModel,
  });
}
