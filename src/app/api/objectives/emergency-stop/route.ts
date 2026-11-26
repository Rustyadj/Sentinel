import { NextResponse } from "next/server";
import { emergencyStopWorkspace } from "@/lib/objectives/service";
import { currentUserId, objectiveErrorResponse } from "../_shared";

/** Stops every active or paused objective in a workspace and cancels their in-flight agent runs. */
export async function POST(request: Request) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { workspaceId?: unknown } | null;
  if (typeof body?.workspaceId !== "string") return NextResponse.json({ error: "workspaceId is required" }, { status: 400 });
  try {
    return NextResponse.json({ stopped: await emergencyStopWorkspace(userId, body.workspaceId) });
  } catch (error) {
    return objectiveErrorResponse(error);
  }
}
