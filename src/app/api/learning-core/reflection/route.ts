import { NextResponse } from "next/server";
import { listReflections, recordReflection } from "@/lib/learning-core/reflection";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const reflections = await listReflections({
    agentId: searchParams.get("agentId") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(reflections);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  const reflection = await recordReflection(body);
  return NextResponse.json(reflection);
}
