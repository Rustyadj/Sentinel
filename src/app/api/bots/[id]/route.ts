import { NextResponse } from "next/server";
import { errorResponse, readBody, requireBotAccess } from "@/lib/bots/api";
import { deleteBot, getBotRow, toBotRecord, toGrant, updateBot } from "@/lib/bots/service";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    await requireBotAccess(id);
    const row = await getBotRow(id);
    if (!row) return NextResponse.json({ error: "Bot not found" }, { status: 404 });
    return NextResponse.json({
      bot: toBotRecord(row),
      grants: row.toolPermissions.map(toGrant),
      skills: row.skills.map((link) => ({ id: link.skill.id, name: link.skill.name, description: link.skill.description, status: link.skill.status, enabled: link.enabled, requiredTools: link.skill.requiredTools })),
    });
  } catch (error) { return errorResponse(error); }
}

async function patch(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    return NextResponse.json({ bot: await updateBot(id, await readBody(request) as Parameters<typeof updateBot>[1], user.id) });
  } catch (error) { return errorResponse(error); }
}
export const PUT = patch;
export const PATCH = patch;

export async function DELETE(_request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    await deleteBot(id, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
