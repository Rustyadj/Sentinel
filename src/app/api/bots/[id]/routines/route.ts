import { NextResponse } from "next/server";
import { errorResponse, readBody, requireBotAccess } from "@/lib/bots/api";
import { createRoutine, listRoutines } from "@/lib/bots/routines";

type Ctx = { params: Promise<{ id: string }> };
export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireBotAccess(id);
    return NextResponse.json({ routines: await listRoutines(id) });
  } catch (error) { return errorResponse(error); }
}
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    return NextResponse.json({ routine: await createRoutine(id, await readBody(request), user.id) }, { status: 201 });
  } catch (error) { return errorResponse(error); }
}
