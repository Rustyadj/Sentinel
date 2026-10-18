import { db } from "@/lib/db";
import { adminWorkspaceIds, requireBotAdmin } from "@/lib/bots/api";
import { envSecret, TelegramError } from "./policy";
import { telegramCall } from "./client";
import { resolveBinding } from "./service";

export async function telegramStatus() {
  const { user, workspaceIds } = await adminWorkspaceIds();
  const bots = await db.telegramBot.findMany({ where: { workspaceId: { in: workspaceIds } }, select: { id: true, key: true, agentId: true, botId: true, workspaceId: true, enabled: true, cutoverVerifiedAt: true, lastWebhookAt: true, lastHealthAt: true, webhookHealth: true } });
  const botIds = bots.map((b) => b.id);
  const [conversations, updates] = await Promise.all([
    db.telegramConversation.findMany({ where: { telegramBotId: { in: botIds }, userId: user.id }, orderBy: { createdAt: "desc" }, take: 100 }),
    db.telegramUpdate.findMany({ where: { telegramBotId: { in: botIds } }, select: { id: true, telegramBotId: true, updateId: true, chatId: true, messageId: true, replyToMessageId: true, status: true, taskId: true, currentTaskId: true, chatRoomId: true, errorCode: true, receivedAt: true, completedAt: true, mediaPaths: true, deliveries: { select: { id: true, status: true, errorCode: true, telegramMessageId: true, attempts: true } } }, orderBy: { receivedAt: "desc" }, take: 100 }),
  ]);
  return { enabled: process.env.TELEGRAM_GATEWAY_ENABLED === "true", bots, conversations, updates };
}

export async function checkBotHealth(key: string) {
  const binding = await resolveBinding(key); await requireBotAdmin(binding.workspaceId);
  const token = envSecret(binding.tokenEnvVar);
  const [identity, webhook] = await Promise.all([
    telegramCall<{ id: number; username: string }>(token, "getMe"),
    telegramCall<{ url: string; pending_update_count: number; last_error_date?: number }>(token, "getWebhookInfo"),
  ]);
  if (String(identity.id) !== binding.telegramBotId) throw new TelegramError("telegram_bot_identity_mismatch", 409);
  const origin = process.env.TELEGRAM_WEBHOOK_ORIGIN;
  const expectedUrl = origin ? `${origin}/api/telegram/webhooks/${binding.key}` : null;
  const health = { identityMatches: true, username: identity.username, webhookMatches: webhook.url === expectedUrl, pendingUpdates: webhook.pending_update_count, lastErrorAt: webhook.last_error_date ?? null };
  await db.telegramBot.update({ where: { id: binding.id }, data: { lastHealthAt: new Date(), webhookHealth: health } });
  return health;
}
