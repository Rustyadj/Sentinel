import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { placeOutboundCall } from "@/lib/telephony/calls/service";
import { telephonyErrorResponse } from "@/lib/telephony/http";

export const runtime = "nodejs";

const placeCallBody = z.object({
  agent: z.string().min(1).max(60),
  target: z.string().min(1).max(120),
  purpose: z.string().min(1).max(1_000),
  idempotencyKey: z.string().min(8).max(120).optional(),
});

/** Place an outbound call as Lisa or Nathan2. The call starts immediately; there is no confirmation step. */
export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = placeCallBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const { call, replayed } = await placeOutboundCall({ userId: user.id, ...parsed.data });
    return NextResponse.json({ call, replayed }, { status: replayed ? 200 : 201 });
  } catch (error) {
    return telephonyErrorResponse(error);
  }
}

export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const limit = Math.min(Number(req.nextUrl.searchParams.get("limit") ?? "50") || 50, 200);
    const calls = await db.phoneCall.findMany({ where: { userId: user.id }, orderBy: { startedAt: "desc" }, take: limit });
    return NextResponse.json({ calls });
  } catch (error) {
    return telephonyErrorResponse(error);
  }
}
