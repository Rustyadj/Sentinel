import { NextResponse } from "next/server";
import { getTrustCenter, recordTrustEvent, TRUST_EVENT_DELTAS } from "@/lib/learning-core/trust";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await getTrustCenter(searchParams.get("agentId") ?? undefined));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.agentId || !body.category || !body.reason) {
      return NextResponse.json({ error: "agentId, category, and reason are required" }, { status: 400 });
    }
    if (!(body.category in TRUST_EVENT_DELTAS)) {
      return NextResponse.json({ error: "Unknown trust event category" }, { status: 400 });
    }
    return NextResponse.json(await recordTrustEvent(body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to record trust event" }, { status: 400 });
  }
}
