import { timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { summarizeCall } from "@/lib/telephony/calls/summary";
import { runVoiceReasoningTurn } from "@/lib/voice/reasoning-bridge";

export const runtime = "nodejs";

const body = z.discriminatedUnion("mode", [
  z.object({ mode: z.literal("turn"), callId: z.string().min(1).max(100), request: z.string().min(1).max(8_000) }),
  z.object({ mode: z.literal("summary"), callId: z.string().min(1).max(100) }),
]);

function authorized(req: NextRequest): boolean {
  const secret = process.env.TELNYX_BRIDGE_SECRET;
  if (!secret || secret.length < 32) return false; // fail closed
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer /, "") ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/**
 * Internal endpoint for the media-bridge process: runs one phone turn on the
 * call's agent. Identity is never taken from the request body -- the call row
 * names the agent, user and room, so even a leaked bridge secret can only drive
 * calls that exist, as the agent they belong to, and only while still active.
 * Screened (unknown-caller) calls are refused outright: they have no runtime access.
 */
export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const parsed = body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });

  const call = await db.phoneCall.findUnique({ where: { id: parsed.data.callId } });
  if (!call || call.trust !== "trusted") return NextResponse.json({ error: "Call not available" }, { status: 403 });

  if (parsed.data.mode === "summary") {
    const summary = await summarizeCall(call.id);
    return NextResponse.json({ summary });
  }

  if (call.status !== "active" || !call.roomId) return NextResponse.json({ error: "Call is not active" }, { status: 409 });
  try {
    const result = await runVoiceReasoningTurn({
      agentId: call.agentId,
      userId: call.userId,
      roomId: call.roomId,
      request: parsed.data.request,
      signal: req.signal,
    });
    if (result.cancelled) return NextResponse.json({ error: "Cancelled" }, { status: 499 });
    return NextResponse.json({ answer: result.answer, toolCalls: result.toolCalls });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Reasoning failed";
    return NextResponse.json({ error: message.slice(0, 240) }, { status: 502 });
  }
}
