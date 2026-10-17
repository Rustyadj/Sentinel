import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { telephonyErrorResponse } from "@/lib/telephony/http";
import { isE164, normalizeE164 } from "@/lib/telephony/telnyx/config";

export const runtime = "nodejs";

const contactBody = z.object({
  name: z.string().min(1).max(120),
  number: z.string().min(7).max(20),
  callable: z.boolean().optional(),
  notes: z.string().max(500).optional(),
});

export async function GET() {
  try {
    const user = await requireUser();
    return NextResponse.json({ contacts: await db.phoneContact.findMany({ where: { userId: user.id }, orderBy: { name: "asc" } }) });
  } catch (error) {
    return telephonyErrorResponse(error);
  }
}

export async function POST(req: NextRequest) {
  try {
    const user = await requireUser();
    const parsed = contactBody.safeParse(await req.json().catch(() => null));
    if (!parsed.success) return NextResponse.json({ error: "Invalid request body" }, { status: 400 });
    const number = normalizeE164(parsed.data.number);
    if (!isE164(number)) return NextResponse.json({ error: "Number must be E.164, e.g. +15551234567" }, { status: 422 });
    const contact = await db.phoneContact.upsert({
      where: { userId_number: { userId: user.id, number } },
      create: { userId: user.id, number, name: parsed.data.name, callable: parsed.data.callable ?? true, notes: parsed.data.notes },
      update: { name: parsed.data.name, callable: parsed.data.callable ?? true, notes: parsed.data.notes },
    });
    return NextResponse.json({ contact }, { status: 201 });
  } catch (error) {
    return telephonyErrorResponse(error);
  }
}
