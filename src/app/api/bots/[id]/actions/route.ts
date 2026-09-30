import { NextResponse } from "next/server";
import { errorResponse, HttpError, readBody, requireBotAccess } from "@/lib/bots/api";
import { disableBot, duplicateBot, enableBot } from "@/lib/bots/service";

type Ctx = { params: Promise<{ id: string }> };

/** enable | disable | duplicate. */
export async function POST(request: Request, { params }: Ctx) {
  try {
    const { id } = await params;
    const { user } = await requireBotAccess(id);
    const body = await readBody(request);
    switch (body.action) {
      case "enable": return NextResponse.json({ bot: await enableBot(id, user.id) });
      case "disable": return NextResponse.json({ bot: await disableBot(id, user.id) });
      case "duplicate": return NextResponse.json({ bot: await duplicateBot(id, user.id, typeof body.name === "string" ? body.name : undefined) }, { status: 201 });
      default: throw new HttpError("action must be enable, disable or duplicate", 400);
    }
  } catch (error) { return errorResponse(error); }
}
