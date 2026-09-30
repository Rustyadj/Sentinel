import { NextResponse } from "next/server";
import { errorResponse, HttpError, readBody, requiredString, requireBotAccess } from "@/lib/bots/api";
import { assignSkill, removeSkill, setSkillEnabled } from "@/lib/bots/service";

type Ctx = { params: Promise<{ id: string }> };

export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    return NextResponse.json(await assignSkill(id, requiredString(await readBody(request), "skillId"), user.id), { status: 201 });
  } catch (error) { return errorResponse(error); }
}

export async function PATCH(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    const body = await readBody(request);
    if (typeof body.enabled !== "boolean") throw new HttpError("enabled must be true or false", 400);
    await setSkillEnabled(id, requiredString(body, "skillId"), body.enabled, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}

export async function DELETE(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    const skillId = new URL(request.url).searchParams.get("skillId");
    if (!skillId) throw new HttpError("skillId is required", 400);
    return NextResponse.json({ removed: await removeSkill(id, skillId, user.id) });
  } catch (error) { return errorResponse(error); }
}
