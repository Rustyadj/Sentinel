import { NextResponse } from "next/server";
import { listCuriosityEvents, recordCuriosityEvent } from "@/lib/learning-core/curiosity";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const events = await listCuriosityEvents({
    agentId: searchParams.get("agentId") ?? undefined,
    unresolvedOnly: searchParams.get("unresolved") === "true",
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(events);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.agentId || !body.factors) {
    return NextResponse.json({ error: "agentId and factors are required" }, { status: 400 });
  }
  const event = await recordCuriosityEvent({
    agentId: body.agentId,
    factors: body.factors,
    triggerContext: body.triggerContext,
    question: body.question,
  });
  return NextResponse.json(event);
}
