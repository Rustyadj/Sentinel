import { NextResponse } from "next/server";
import { appendEvolutionEvent, EVOLUTION_STAGES, listEvolutionEvents } from "@/lib/learning-core/evolution";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await listEvolutionEvents({
    stage: searchParams.get("stage") ?? undefined,
    relatedType: searchParams.get("relatedType") ?? undefined,
    relatedId: searchParams.get("relatedId") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  }));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.title || !EVOLUTION_STAGES.includes(body.stage)) {
      return NextResponse.json({ error: "title and a valid stage are required" }, { status: 400 });
    }
    return NextResponse.json(await appendEvolutionEvent(body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to append evolution event" }, { status: 400 });
  }
}
