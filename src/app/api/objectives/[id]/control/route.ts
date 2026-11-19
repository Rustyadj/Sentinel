import { NextResponse } from "next/server";
import { controlObjective, type ControlAction } from "@/lib/objectives/service";
import { currentUserId, objectiveErrorResponse } from "../../_shared";

type Context = { params: Promise<{ id: string }> };
const ACTIONS: readonly ControlAction[] = ["pause", "resume", "stop", "retry_step"];

export async function POST(request: Request, { params }: Context) {
  const userId = await currentUserId();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = (await request.json().catch(() => null)) as { action?: unknown; stepKey?: unknown } | null;
  const action = ACTIONS.find((a) => a === body?.action);
  if (!action) return NextResponse.json({ error: `action must be one of ${ACTIONS.join(", ")}` }, { status: 400 });
  const stepKey = typeof body?.stepKey === "string" ? body.stepKey.slice(0, 64) : undefined;
  if (action === "retry_step" && !stepKey) return NextResponse.json({ error: "stepKey is required for retry_step" }, { status: 400 });
  try {
    const { id } = await params;
    await controlObjective(userId, id, action, stepKey);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return objectiveErrorResponse(error);
  }
}
