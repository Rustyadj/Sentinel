/** Explicit, reviewed history import. No Hermes memory synchronization. */
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { z } from "zod";
import { db } from "../../src/lib/db";
import { expectedAgent } from "../../src/lib/telegram/policy";
import { writeAuditLog } from "../../src/lib/workspaces/audit";
const inputSchema = z.object({ agentId: z.string(), telegramChatId: z.string().regex(/^\d+$/), senderId: z.string().regex(/^\d+$/), messages: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(20000), at: z.iso.datetime() })).max(500) }).strict();
async function main() {
  const [key, path, reviewedSha256] = process.argv.slice(2);
  if (!key || !path || !/^[a-f0-9]{64}$/.test(reviewedSha256 ?? "")) throw new Error("Usage: import-history.ts lisa|nathan2 reviewed-export.json sha256");
  const bytes = await readFile(path); if (bytes.length > 2_000_000) throw new Error("History export exceeds 2 MB");
  if (createHash("sha256").update(bytes).digest("hex") !== reviewedSha256) throw new Error("History export changed since review");
  const input = inputSchema.parse(JSON.parse(bytes.toString("utf8"))); expectedAgent(key, input.agentId);
  const bot = await db.telegramBot.findUniqueOrThrow({ where: { key } });
  if (bot.enabled) throw new Error("Pause this binding before importing reviewed history");
  const access = await db.telegramAccess.findUniqueOrThrow({ where: { telegramBotId_senderId_chatId: { telegramBotId: bot.id, senderId: input.senderId, chatId: input.telegramChatId } } });
  if (!access.enabled || input.senderId !== input.telegramChatId) throw new Error("History must belong to an explicitly authorized private conversation");
  await db.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`${bot.id}:${input.telegramChatId}:${input.senderId}`}, 0))`;
    let conversation = await tx.telegramConversation.findUnique({ where: { telegramBotId_senderId_chatId: { telegramBotId: bot.id, senderId: input.senderId, chatId: input.telegramChatId } } });
    if (!conversation) {
      const room = await tx.chatRoom.create({ data: { name: `Telegram · ${key} · ${input.telegramChatId}`, userId: access.userId, agentIds: [bot.agentId], mode: "solo" } });
      conversation = await tx.telegramConversation.create({ data: { telegramBotId: bot.id, senderId: input.senderId, chatId: input.telegramChatId, userId: access.userId, chatRoomId: room.id } });
    }
    if (conversation.userId !== access.userId) throw new Error("Conversation ownership changed");
    const inserted = await tx.message.createMany({ data: input.messages.map((m, i) => ({ id: `tg-import-${conversation!.id}-${reviewedSha256}-${i}`, chatRoomId: conversation!.chatRoomId, role: m.role === "assistant" ? "agent" : "user", agentId: m.role === "assistant" ? bot.agentId : null, content: m.content.replace(/\b\d{6,15}:[A-Za-z0-9_-]{25,}\b/g, "[redacted Telegram credential]"), runtimeKind: "hermes", provider: "reviewed-history-import", createdAt: new Date(m.at) })), skipDuplicates: true });
    await writeAuditLog({ workspaceId: bot.workspaceId, userId: access.userId, actorType: "system", action: "telegram.history_imported", entityType: "ChatRoom", entityId: conversation.chatRoomId, details: { sourceSha256: reviewedSha256, source: "explicit-reviewed-hermes-export", agentId: bot.agentId, inserted: inserted.count } }, tx);
    console.log(JSON.stringify({ chatRoomId: conversation.chatRoomId, inserted: inserted.count }));
  });
}
main().catch(() => { console.error("History import refused; review source scope, digest and protected configuration."); process.exitCode = 1; }).finally(() => db.$disconnect());
