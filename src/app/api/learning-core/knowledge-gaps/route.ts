import { NextResponse } from "next/server";
import { listKnowledgeGaps, recordKnowledgeGap } from "@/lib/learning-core/knowledge-gaps";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const gaps = await listKnowledgeGaps({
    agentId: searchParams.get("agentId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  });
  return NextResponse.json(gaps);
}

export async function POST(req: Request) {
  const body = await req.json();
  if (!body.agentId || !body.topic || !body.description || body.confidence === undefined) {
    return NextResponse.json(
      { error: "agentId, topic, description, and confidence are required" },
      { status: 400 }
    );
  }
  const gap = await recordKnowledgeGap({
    agentId: body.agentId,
    topic: body.topic,
    description: body.description,
    confidence: body.confidence,
    estimatedBenefit: body.estimatedBenefit,
  });
  return NextResponse.json(gap);
}
