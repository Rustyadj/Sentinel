import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import {
  SENTINEL_REASONING_TOOL_DEFINITION,
  liveSessionInstructions,
  resolveAgentVoiceConfig,
} from "@/lib/voice/agent-voice-config";
import { startVoiceSessionTelemetry } from "@/lib/voice/telemetry";

export const runtime = "nodejs";

interface SessionRequestBody {
  agentId?: string;
  roomId?: string;
  language?: string;
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

  const openAIResponse = await fetch("https://api.openai.com/v1/realtime/client_secrets", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
      "OpenAI-Safety-Identifier": createHash("sha256").update(user.id).digest("hex"),
    },
    body: JSON.stringify({
      expires_after: { anchor: "created_at", seconds: 600 },
      session: {
        type: "realtime",
        model: config.voiceModel,
        output_modalities: ["audio"],
        instructions,
        audio: {
          input: {
            transcription: { model: config.transcriptionModel },
            noise_reduction: { type: "far_field" },
            // Full duplex: the model listens while speaking and yields when
            // the user starts talking, which is what makes barge-in work.
            turn_detection: {
              type: "semantic_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: config.voice },
        },
        tools: [SENTINEL_REASONING_TOOL_DEFINITION],
        tool_choice: "auto",
      },
    }),
    cache: "no-store",
  });

  const payload = (await openAIResponse.json().catch(() => null)) as {
    value?: string;
    expires_at?: number;
    error?: { message?: string };
  } | null;

  if (!openAIResponse.ok || !payload?.value) {
    const detail = payload?.error?.message?.slice(0, 240);
    return NextResponse.json(
      { error: detail || "The live voice provider could not create a session" },
      { status: openAIResponse.status >= 400 && openAIResponse.status < 500 ? 502 : 503 },
    );
  }

  const sessionId = await startVoiceSessionTelemetry({
    userId: user.id,
    agentId: config.agentId,
    roomId: body.roomId ?? null,
    voiceModel: config.voiceModel,
    reasoningModel: config.reasoningModel,
  }).catch(() => null);

  return NextResponse.json({
    clientSecret: payload.value,
    expiresAt: payload.expires_at,
    sessionId,
    agentId: config.agentId,
    voice: config.voice,
    voiceModel: config.voiceModel,
    reasoningModel: config.reasoningModel,
    transcriptionModel: config.transcriptionModel,
  });
}
