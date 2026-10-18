import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, HttpError, readBody, requireBotAccess, requiredString } from "@/lib/bots/api";
import { editRoutine, getRoutine, reconcileRoutineRuns, requestRoutineRun, routineAction } from "@/lib/bots/routines";

type Ctx = { params: Promise<{ id: string; routineId: string }> };
async function authorize(params: Ctx["params"]) {
  const { id, routineId } = await params;
  const { bot, user } = await requireBotAccess(id);
  const routine = await db.workflow.findFirst({ where: { id: routineId, kind: "routine", botId: id, workspaceId: bot.workspaceId } });
  if (!routine) throw new HttpError("Routine not found", 404);
  return { routineId, user };
}
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { routineId } = await authorize(params);
    await reconcileRoutineRuns(routineId);
    return NextResponse.json({ routine: await getRoutine(routineId) });
  } catch (error) { return errorResponse(error); }
}
export async function PUT(request: Request, { params }: Ctx) {
  try {
    const { routineId, user } = await authorize(params);
    const { revision, ...input } = await readBody(request);
    if (!Number.isInteger(revision)) throw new HttpError("revision is required", 400);
    await editRoutine(routineId, input, user.id, revision as number);
    return NextResponse.json({ routine: await getRoutine(routineId) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { routineId, user } = await authorize(params);
    const body = await readBody(request);
    if (body.action === "test" || body.action === "run") {
      const run = await requestRoutineRun(routineId, body.action === "test" ? "test" : "manual", requiredString(body, "idempotencyKey"), user.id);
      return NextResponse.json({ run }, { status: 202 });
    }
    if (!["review", "enable", "pause", "reject"].includes(String(body.action))) throw new HttpError("action must be review, test, enable, pause, run or reject", 400);
    await routineAction(routineId, body.action as "review" | "enable" | "pause" | "reject", user.id, typeof body.digest === "string" ? body.digest : undefined);
    return NextResponse.json({ routine: await getRoutine(routineId) });
  } catch (error) { return errorResponse(error); }
}
