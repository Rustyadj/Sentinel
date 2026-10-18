import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { errorResponse, HttpError, readBody, requireBotAdmin } from "@/lib/bots/api";
import { checkBotHealth } from "@/lib/telegram/admin";
import { resolveBinding } from "@/lib/telegram/service";
import { TelegramError } from "@/lib/telegram/policy";
import { writeAuditLog } from "@/lib/workspaces/audit";
export async function POST(request: Request, { params }: { params: Promise<{ key: string }> }) {
  try {
    const binding = await resolveBinding((await params).key);
    const user = await requireBotAdmin(binding.workspaceId); const body = await readBody(request);
    if (body.action === "health") return NextResponse.json(await checkBotHealth(binding.key));
    if (body.action !== "pause") throw new HttpError("Use the verified cutover procedure to enable routing; action must be health or pause", 400);
    await db.telegramBot.update({ where: { id: binding.id }, data: { enabled: false } });
    await writeAuditLog({ workspaceId: binding.workspaceId, userId: user.id, action: "telegram.paused", entityType: "TelegramBot", entityId: binding.id });
    return NextResponse.json({ paused: true });
  } catch (error) { if (error instanceof TelegramError) return NextResponse.json({ error: error.code }, { status: error.status }); return errorResponse(error); }
}
