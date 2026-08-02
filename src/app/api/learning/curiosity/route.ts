import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listCuriosityEvents, recordCuriosityEvent } from "@/lib/learning/curiosity";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const events = await listCuriosityEvents({
    agentId: searchParams.get("agentId") ?? undefined,
    unansweredOnly: searchParams.get("unanswered") === "true",
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(events);
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.agentId || !body.triggerType || !body.factors) {
    return NextResponse.json({ error: "agentId, triggerType, and factors are required" }, { status: 400 });
  }
  const result = await recordCuriosityEvent(body);
  return NextResponse.json(result);
}
