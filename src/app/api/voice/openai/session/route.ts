import { createHash } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import {
  getOpenAIRealtimeModelConfig,
  openAIRealtimeInstructions,
  OPENAI_REALTIME_ESCALATION_TOOL_DEFINITION,
  resolveOpenAIRealtimeAgentId,
} from "@/lib/voice/openai-realtime-config";

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
      { error: "OpenAI Realtime is not configured on this deployment" },
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

  const agentId = resolveOpenAIRealtimeAgentId(body.agentId);
  if (!agentId) {
    return NextResponse.json(
      { error: "OpenAI Realtime is enabled only for Hermes Lisa and Hermes Nathan2" },
      { status: 400 },
    );
  }

  if (body.roomId) {
    const room = await db.chatRoom.findFirst({
      where: { id: body.roomId, userId: user.id },
      select: { id: true },
    });
    if (!room) return NextResponse.json({ error: "Room not found" }, { status: 404 });
  }

  const models = getOpenAIRealtimeModelConfig();
  const language = body.language?.trim().slice(0, 35);
  const instructions = [
    openAIRealtimeInstructions(agentId),
    language ? `The user's preferred language is ${language}.` : "",
  ].filter(Boolean).join("\n\n");

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
        model: models.miniModel,
        output_modalities: ["audio"],
        instructions,
        audio: {
          input: {
            transcription: { model: models.transcriptionModel },
            noise_reduction: { type: "far_field" },
            turn_detection: {
              type: "semantic_vad",
              create_response: true,
              interrupt_response: true,
            },
          },
          output: { voice: models.voice },
        },
        tools: [OPENAI_REALTIME_ESCALATION_TOOL_DEFINITION],
        tool_choice: "auto",
      },
    }),
    cache: "no-store",
  });

  const payload = await openAIResponse.json().catch(() => null) as {
    value?: string;
    expires_at?: number;
    error?: { message?: string };
  } | null;

  if (!openAIResponse.ok || !payload?.value) {
    const detail = payload?.error?.message?.slice(0, 240);
    return NextResponse.json(
      { error: detail || "OpenAI could not create a Realtime session" },
      { status: openAIResponse.status >= 400 && openAIResponse.status < 500 ? 502 : 503 },
    );
  }

  return NextResponse.json({
    clientSecret: payload.value,
    expiresAt: payload.expires_at,
    model: models.miniModel,
    escalationModel: models.fullModel,
    transcriptionModel: models.transcriptionModel,
    agentId,
  });
}
