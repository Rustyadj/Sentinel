import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { db } from "@/lib/db";
import { errorResponse, HttpError, requireBotAdmin } from "@/lib/bots/api";
export async function GET(_request: Request, { params }: { params: Promise<{ id: string; index: string }> }) {
  try {
    const { id, index } = await params;
    const update = await db.telegramUpdate.findUnique({ where: { id }, include: { bot: true } });
    if (!update || !/^\d{1,2}$/.test(index)) throw new HttpError("Attachment not found", 404);
    await requireBotAdmin(update.bot.workspaceId);
    const file = update.mediaPaths[Number(index)]?.match(/\/([0-9]+\.[a-zA-Z0-9]{1,8})$/)?.[1];
    if (!file || !process.env.TELEGRAM_MEDIA_ROOT) throw new HttpError("Attachment expired or unavailable", 404);
    const content = await readFile(join(process.env.TELEGRAM_MEDIA_ROOT, update.id, file)).catch(() => null);
    if (!content) throw new HttpError("Attachment unavailable", 404);
    return new Response(new Uint8Array(content), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename="${file}"`, "Cache-Control": "private, no-store", "X-Content-Type-Options": "nosniff" } });
  } catch (error) { return errorResponse(error); }
}
