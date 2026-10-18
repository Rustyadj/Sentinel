import { NextResponse } from "next/server";
import { getControlPlaneUser } from "@/lib/agents/permissions";
import { errorResponse, HttpError, readBody, requiredString } from "@/lib/bots/api";
import { submitConversationTurn } from "@/lib/telegram/service";
import { TelegramError } from "@/lib/telegram/policy";
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const user = await getControlPlaneUser(); if (!user) throw new HttpError("Unauthorized", 401);
    const body = await readBody(request);
    const update = await submitConversationTurn((await params).id, user.id, requiredString(body, "text"), requiredString(body, "idempotencyKey"));
    return NextResponse.json({ id: update.id }, { status: 202 });
  } catch (error) { if (error instanceof TelegramError) return NextResponse.json({ error: error.code }, { status: error.status }); return errorResponse(error); }
}
