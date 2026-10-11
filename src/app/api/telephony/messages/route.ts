import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { sendAgentMessage } from "@/lib/telephony/calls/messaging";
import { telephonyErrorResponse } from "@/lib/telephony/http";

export const runtime = "nodejs";

const sendBody = z.object({
  agent: z.string().min(1).max(60),
  target: z.string().min(1).max(120),
  text: z.string().max(1_500).default(""),
  mediaUrls: z.array(z.string().url()).max(10).optional(),
});

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = sendBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const message = await sendAgentMessage({ userId: user.id, ...parsed.data });
    return NextResponse.json({ message }, { status: 201 });
  } catch (error) {
    return telephonyErrorResponse(error);
  }
}

/** With ?counterparty=+1555… returns that thread; otherwise the most recent message per counterparty. */
export async function GET(req: NextRequest) {
  try {
    const user = await requireUser();
    const counterparty = req.nextUrl.searchParams.get("counterparty");
    if (counterparty) {
      const messages = await db.phoneMessage.findMany({
        where: { userId: user.id, counterparty }, orderBy: { createdAt: "asc" }, take: 200,
      });
      return NextResponse.json({ messages });
    }
    const recent = await db.phoneMessage.findMany({ where: { userId: user.id }, orderBy: { createdAt: "desc" }, take: 300 });
    const threads = new Map<string, (typeof recent)[number]>();
    for (const m of recent) if (!threads.has(m.counterparty)) threads.set(m.counterparty, m);
    return NextResponse.json({ threads: [...threads.values()] });
  } catch (error) {
    return telephonyErrorResponse(error);
  }
}
