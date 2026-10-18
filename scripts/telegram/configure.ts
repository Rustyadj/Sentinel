/** Operator-only local CLI. No tokens or Telegram payloads are printed. */
import { userHasWorkspacePermission } from "../../src/lib/workspaces/authorization";
import { db } from "../../src/lib/db";
import { envSecret, expectedAgent } from "../../src/lib/telegram/policy";
import { telegramCall } from "../../src/lib/telegram/client";

async function main() {
  const [action, key, botId, userId, senderId, chatId] = process.argv.slice(2);
  if (!key || !["lisa", "nathan2"].includes(key)) throw new Error("Usage: configure.ts register|webhook|pause|enable|rollback lisa|nathan2 [botId userId senderId chatId]");
  const prefix = `TELEGRAM_${key.toUpperCase()}`;
  const token = envSecret(`${prefix}_BOT_TOKEN`);
  const identity = await telegramCall<{ id: number; username: string }>(token, "getMe");
  if (action === "register") {
    if (!botId || !userId || !/^\d+$/.test(senderId ?? "") || senderId !== chatId) throw new Error("Register requires an existing Sentinel bot, user ID and matching private Telegram sender/chat IDs");
    const bot = await db.bot.findUniqueOrThrow({ where: { id: botId } }); expectedAgent(key, bot.runtimeAgentId);
    if (!await userHasWorkspacePermission(userId, bot.workspaceId, "agents.runtime.execute")) throw new Error("Sentinel user lacks runtime execution permission in the agent workspace");
    const expectedId = key === "lisa" ? "8768848729" : "8790562826";
    if (String(identity.id) !== expectedId) throw new Error("Credential does not belong to the existing Telegram identity");
    const binding = await db.telegramBot.upsert({ where: { key }, create: { key, telegramBotId: String(identity.id), botId, agentId: bot.runtimeAgentId, workspaceId: bot.workspaceId, tokenEnvVar: `${prefix}_BOT_TOKEN`, webhookSecretEnvVar: `${prefix}_WEBHOOK_SECRET` }, update: {} });
    if (binding.botId !== bot.id) throw new Error("Binding already exists for another bot; refusing to retarget an identity");
    await db.telegramAccess.upsert({ where: { telegramBotId_senderId_chatId: { telegramBotId: binding.id, senderId, chatId } }, create: { telegramBotId: binding.id, senderId, chatId, userId }, update: { userId, enabled: true } });
    console.log(JSON.stringify({ registered: key, username: identity.username, enabled: binding.enabled })); return;
  }
  const binding = await db.telegramBot.findUniqueOrThrow({ where: { key } });
  if (String(identity.id) !== binding.telegramBotId) throw new Error("Telegram bot identity mismatch");
  if (action === "pause") { await db.telegramBot.update({ where: { key }, data: { enabled: false } }); console.log("Paused future admission and delivery"); return; }
  if (action === "webhook") {
    const origin = process.env.TELEGRAM_WEBHOOK_ORIGIN;
    if (!origin || new URL(origin).protocol !== "https:" || new URL(origin).pathname !== "/") throw new Error("An HTTPS TELEGRAM_WEBHOOK_ORIGIN without a path is required");
    await telegramCall(token, "setWebhook", { url: `${origin.replace(/\/$/, "")}/api/telegram/webhooks/${key}`, secret_token: envSecret(`${prefix}_WEBHOOK_SECRET`), allowed_updates: ["message"], max_connections: 4, drop_pending_updates: false });
    console.log("Webhook registered without dropping updates; execution remains unchanged"); return;
  }
  if (action === "enable") {
    // Root-only cutover evidence is produced by the procedure in docs. A flag
    // cannot replace live verification: this deliberately requires explicit operator action.
    if (process.env.TELEGRAM_VERIFIED_CUTOVER !== `${key}:verified`) throw new Error("Complete and record the cutover checklist, then explicitly set TELEGRAM_VERIFIED_CUTOVER=<key>:verified");
    const webhook = await telegramCall<{ url: string }>(token, "getWebhookInfo");
    if (webhook.url !== `${process.env.TELEGRAM_WEBHOOK_ORIGIN?.replace(/\/$/, "")}/api/telegram/webhooks/${key}`) throw new Error("Telegram webhook does not point to Sentinel");
    await db.telegramBot.update({ where: { key }, data: { enabled: true, cutoverVerifiedAt: new Date() } });
    console.log("Enabled the verified binding. Runtime session gate is independently checked before every turn."); return;
  }
  if (action === "rollback") {
    await db.telegramBot.update({ where: { key }, data: { enabled: false } });
    const active = await db.orchestrationRun.count({ where: { botId: binding.botId, status: { in: ["queued", "running", "waiting", "cancelling"] }, request: { path: ["channel", "kind"], equals: "telegram" } } });
    if (active) throw new Error("Drain or cancel admitted Telegram tasks before restoring the old consumer");
    const oldUrl = process.env.TELEGRAM_PREVIOUS_WEBHOOK_URL;
    if (oldUrl) {
      if (new URL(oldUrl).protocol !== "https:") throw new Error("Previous webhook must be HTTPS");
      const previousSecret = process.env.TELEGRAM_PREVIOUS_WEBHOOK_SECRET_FILE;
      if (!previousSecret) throw new Error("Supply the protected previous webhook secret file; do not put it on the command line");
      const { readFileSync } = await import("node:fs");
      await telegramCall(token, "setWebhook", { url: oldUrl, secret_token: readFileSync(previousSecret, "utf8").trim(), drop_pending_updates: false });
    } else await telegramCall(token, "deleteWebhook", { drop_pending_updates: false });
    console.log("Binding paused; prior webhook/polling restored. Drain admitted Sentinel tasks before resuming the old consumer."); return;
  }
  throw new Error("Unknown action");
}
main().catch(() => { console.error("Telegram configuration failed; check protected configuration and operator procedure. Credentials suppressed."); process.exitCode = 1; }).finally(() => db.$disconnect());
