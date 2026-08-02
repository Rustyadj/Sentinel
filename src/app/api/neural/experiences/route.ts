import { NextRequest, NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { startExperience, listAgentExperiences } from "@/lib/neural-engine/experience-service";
import { requireLearningAgentAccess, learningAccessErrorResponse } from "@/lib/learning/authorization";

export async function POST(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body?.agentId || !body?.objective) {
    return NextResponse.json(
      { error: "agentId and objective are required" },
      { status: 400 },
    );
  }
  try {
    await requireLearningAgentAccess(user.id, body.agentId, "workspace.update");
    const experience = await startExperience(body);
    return NextResponse.json(experience, { status: 201 });
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
}

export async function GET(req: NextRequest) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const agentId = req.nextUrl.searchParams.get("agentId");
  if (!agentId) {
    return NextResponse.json({ error: "agentId is required" }, { status: 400 });
  }
  try {
    await requireLearningAgentAccess(user.id, agentId, "workspace.read");
    const limit = Number(req.nextUrl.searchParams.get("limit") ?? "50");
    const experiences = await listAgentExperiences(agentId, limit);
    return NextResponse.json(experiences);
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
}
