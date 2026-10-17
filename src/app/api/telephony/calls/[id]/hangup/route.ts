import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { telephonyErrorResponse } from "@/lib/telephony/http";
import { hangupCall } from "@/lib/telephony/telnyx/client";
import { loadTelnyxConfig } from "@/lib/telephony/telnyx/config";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

export async function POST(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const call = await db.phoneCall.findFirst({ where: { id, userId: user.id } });
    if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    if (!call.telnyxCallControlId || !["queued", "ringing", "active"].includes(call.status)) {
      return NextResponse.json({ error: "Call is not in progress" }, { status: 409 });
    }
    await hangupCall(loadTelnyxConfig(), call.telnyxCallControlId);
    await db.phoneCall.update({ where: { id: call.id }, data: { endReason: "user_hangup" } });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return telephonyErrorResponse(error);
  }
}
