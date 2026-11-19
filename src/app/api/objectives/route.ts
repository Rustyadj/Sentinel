import { NextRequest, NextResponse } from "next/server";
import { objectivesEnabled } from "@/lib/objectives/engine";
import { createObjective, listObjectives, parseCreateObjectiveBody } from "@/lib/objectives/service";
import { currentUserId, objectiveErrorResponse } from "./_shared";

export async function GET(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const workspaceId = request.nextUrl.searchParams.get("workspaceId");
  if (!workspaceId) return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  try {
    return NextResponse.json({ enabled: objectivesEnabled(), objectives: await listObjectives(userId, workspaceId) });
  } catch (error) {
    return objectiveErrorResponse(error);
  }
}

/** One high-level goal in; a planned, durable objective out. Execution happens in the orchestration-worker. */
export async function POST(request: NextRequest) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!objectivesEnabled()) return NextResponse.json({ error: "The objective engine is disabled on this deployment (SENTINEL_OBJECTIVES)." }, { status: 503 });
  try {
    const input = parseCreateObjectiveBody(await request.json().catch(() => null));
    const objective = await createObjective(userId, input);
    return NextResponse.json({ objective: { id: objective.id, title: objective.title, status: objective.status } }, { status: 201 });
  } catch (error) {
    return objectiveErrorResponse(error);
  }
}
