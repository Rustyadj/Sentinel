import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { startExperience, listAgentExperiences } from "@/lib/neural-engine/experience-service";

export async function POST(req: NextRequest) {
  try {
    await requireUser();
    const body = await req.json();
    if (!body?.agentId || !body?.objective) {
      return NextResponse.json(
        { error: "agentId and objective are required" },
        { status: 400 },
      );
    }
    const experience = await startExperience(body);
    return NextResponse.json(experience, { status: 201 });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}

export async function GET(req: NextRequest) {
  try {
    await requireUser();
    const agentId = req.nextUrl.searchParams.get("agentId");
    if (!agentId) {
      return NextResponse.json({ error: "agentId is required" }, { status: 400 });
    }
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
    const experiences = await listAgentExperiences(agentId, limit);
    return NextResponse.json(experiences);
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : String(err) },
      { status: 500 },
    );
  }
}
