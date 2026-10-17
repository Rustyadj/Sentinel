import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { telephonyErrorResponse } from "@/lib/telephony/http";

export const runtime = "nodejs";
type Params = { params: Promise<{ id: string }> };

/** One call with its transcript, scoped to the signed-in owner. */
export async function GET(_req: NextRequest, { params }: Params) {
  try {
    const user = await requireUser();
    const { id } = await params;
    const call = await db.phoneCall.findFirst({
      where: { id, userId: user.id },
      include: { turns: { orderBy: { offsetMs: "asc" } } },
    });
    if (!call) return NextResponse.json({ error: "Call not found" }, { status: 404 });
    return NextResponse.json({ call });
  } catch (error) {
    return telephonyErrorResponse(error);
  }
}
