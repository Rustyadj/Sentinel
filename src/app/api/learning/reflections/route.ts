import { NextResponse } from "next/server";
import { requireUser } from "@/lib/current-user";
import { listReflections, recordReflection } from "@/lib/learning/reflection";
import {
  getAccessibleLearningScope,
  requireLearningAgentAccess,
  learningAccessErrorResponse,
} from "@/lib/learning/authorization";

export async function GET(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const scope = await getAccessibleLearningScope(user.id);
  const reflections = await listReflections({
    agentId: searchParams.get("agentId") ?? undefined,
    status: searchParams.get("status") ?? undefined,
    limit: searchParams.get("limit") ? Number(searchParams.get("limit")) : undefined,
    scope,
  });
  return NextResponse.json(reflections);
}

export async function POST(req: Request) {
  const user = await requireUser().catch(() => null);
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  if (!body.agentId || !body.reflectionType || !body.summary) {
    return NextResponse.json({ error: "agentId, reflectionType, and summary are required" }, { status: 400 });
  }
  try {
    await requireLearningAgentAccess(user.id, body.agentId, "workspace.update");
  } catch (err) {
    return learningAccessErrorResponse(err);
  }
  const reflection = await recordReflection(body);
  return NextResponse.json(reflection);
}
