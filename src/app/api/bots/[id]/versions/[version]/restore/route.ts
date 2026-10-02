import { NextResponse } from "next/server";
import { errorResponse, HttpError, requireBotAccess } from "@/lib/bots/api";
import { restoreBotVersion } from "@/lib/bots/versions";

type Ctx = { params: Promise<{ id: string; version: string }> };

export async function POST(_request: Request, { params }: Ctx) {
  try {
    const { id, version } = await params;
    const parsed = Number(version);
    if (!Number.isInteger(parsed) || parsed < 1) throw new HttpError("version must be a positive integer", 400);
    const { user } = await requireBotAccess(id);
    await restoreBotVersion(id, parsed, user.id);
    return NextResponse.json({ ok: true });
  } catch (error) { return errorResponse(error); }
}
