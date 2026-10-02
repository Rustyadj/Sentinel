import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { BotConfigError, requireBotHost, validateBotModelConfig } from "./models";
import type { BotModelConfig } from "./schema";

type Snapshot = {
  bot: Record<string, unknown>;
  toolPermissions: { serverId: string; toolName: string; permission: string }[];
  skills: { skillId: string; enabled: boolean }[];
};

const BOT_FIELDS = [
  "slug", "name", "role", "description", "avatar", "color", "tags", "templateId", "status",
  "systemPrompt", "mission", "responsibilities", "constraints", "outputPreferences", "workflow",
  "capabilities", "runtimeAgentId", "modelConfig", "memoryPolicy", "delegationPolicy", "limits",
] as const;

function snapshotFor(row: Awaited<ReturnType<typeof loadVersionSource>>): Snapshot {
  const bot = Object.fromEntries(BOT_FIELDS.map((field) => [field, row[field]]));
  return {
    bot,
    toolPermissions: row.toolPermissions.map((grant) => ({ serverId: grant.serverId, toolName: grant.toolName, permission: grant.permission })),
    skills: row.skills.map((skill) => ({ skillId: skill.skillId, enabled: skill.enabled })),
  };
}

async function loadVersionSource(botId: string) {
  const row = await db.bot.findUnique({ where: { id: botId }, include: { toolPermissions: true, skills: true } });
  if (!row) throw new BotConfigError("Bot not found", 404);
  return row;
}

/** Store the complete, post-mutation bot policy.  Version rows are append-only. */
export async function recordBotVersion(botId: string, actorUserId: string, reason: string): Promise<void> {
  await db.$transaction(async (tx) => {
    const row = await tx.bot.findUnique({ where: { id: botId }, include: { toolPermissions: true, skills: true } });
    if (!row) throw new BotConfigError("Bot not found", 404);
    const latest = await tx.botConfigVersion.aggregate({ where: { botId }, _max: { version: true } });
    await tx.botConfigVersion.create({
      data: {
        botId,
        version: (latest._max.version ?? 0) + 1,
        reason,
        snapshot: snapshotFor(row) as unknown as Prisma.InputJsonValue,
        createdByUserId: actorUserId,
      },
    });
  });
}

export async function listBotVersions(botId: string) {
  await loadVersionSource(botId);
  return db.botConfigVersion.findMany({
    where: { botId }, orderBy: { version: "desc" },
    select: { id: true, version: true, reason: true, createdByUserId: true, createdAt: true },
  });
}

function parseSnapshot(value: unknown): Snapshot {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new BotConfigError("Version snapshot is invalid", 409);
  const valueRecord = value as Record<string, unknown>;
  const bot = valueRecord.bot;
  const permissions = valueRecord.toolPermissions;
  const skills = valueRecord.skills;
  if (!bot || typeof bot !== "object" || Array.isArray(bot) || !Array.isArray(permissions) || !Array.isArray(skills)) throw new BotConfigError("Version snapshot is invalid", 409);
  if (!permissions.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).serverId === "string" && typeof (item as Record<string, unknown>).toolName === "string" && typeof (item as Record<string, unknown>).permission === "string")) throw new BotConfigError("Version grants are invalid", 409);
  if (!skills.every((item) => item && typeof item === "object" && typeof (item as Record<string, unknown>).skillId === "string" && typeof (item as Record<string, unknown>).enabled === "boolean")) throw new BotConfigError("Version skills are invalid", 409);
  return value as Snapshot;
}

/** Restore a recorded configuration through a single database transaction and checkpoint the result. */
export async function restoreBotVersion(botId: string, version: number, actorUserId: string) {
  const target = await db.botConfigVersion.findUnique({ where: { botId_version: { botId, version } } });
  if (!target) throw new BotConfigError("Version not found", 404);
  const snapshot = parseSnapshot(target.snapshot);
  const source = await loadVersionSource(botId);
  const runtimeAgentId = snapshot.bot.runtimeAgentId;
  if (typeof runtimeAgentId !== "string") throw new BotConfigError("Version runtime host is invalid", 409);
  const host = await requireBotHost(runtimeAgentId);
  validateBotModelConfig(host.kind, (snapshot.bot.modelConfig ?? {}) as BotModelConfig);
  if (snapshot.bot.status === "active" && !host.executionVerified) {
    throw new BotConfigError(`Host runtime ${host.agentId} has no verified execution contract, so this version cannot be activated.`, 409);
  }
  await db.$transaction(async (tx) => {
    await tx.bot.update({ where: { id: botId }, data: snapshot.bot as Prisma.BotUpdateInput });
    await tx.botToolPermission.deleteMany({ where: { botId } });
    if (snapshot.toolPermissions.length) await tx.botToolPermission.createMany({ data: snapshot.toolPermissions.map((grant) => ({ ...grant, botId, grantedByUserId: actorUserId })) });
    await tx.botSkill.deleteMany({ where: { botId } });
    if (snapshot.skills.length) await tx.botSkill.createMany({ data: snapshot.skills.map((skill) => ({ ...skill, botId, addedByUserId: actorUserId })) });
  });
  await writeAuditLog({ workspaceId: source.workspaceId, userId: actorUserId, action: "bot.version_restored", entityType: "Bot", entityId: botId, details: { version } });
  await recordBotVersion(botId, actorUserId, `rollback:${version}`);
}
