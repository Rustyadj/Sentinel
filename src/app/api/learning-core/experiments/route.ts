import { NextResponse } from "next/server";
import { createExperiment, listExperiments } from "@/lib/learning-core/experiments";

export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  return NextResponse.json(await listExperiments({
    hypothesisId: searchParams.get("hypothesisId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
  }));
}

export async function POST(req: Request) {
  try {
    const body = await req.json();
    if (!body.type) return NextResponse.json({ error: "type is required" }, { status: 400 });
    return NextResponse.json(await createExperiment(body), { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to create experiment" }, { status: 400 });
  }
}
