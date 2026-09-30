// Bot CRUD and configuration. Authorization is the caller's job (the API routes
// resolve the workspace role); every mutation here writes an audit row.

import type { Bot, BotToolPermission, Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { loadCatalog } from "./catalog";
import { BotConfigError, requireBotHost, validateBotModelConfig } from "./models";
import {
  createBotSchema, delegationPolicySchema, grantToolSchema, limitsSchema, memoryPolicySchema, modelConfigSchema,
  slugify, updateBotSchema, workflowStepSchema,
  type BotDelegationPolicy, type BotLimits, type BotMemoryPolicy, type BotModelConfig, type BotStatus, type BotWorkflowStep,
  type CreateBotInput, type GrantToolInput, type ToolPermission, type UpdateBotInput,
} from "./schema";
import { z } from "zod";

export const ACTIVE_RUN_STATUSES = ["queued", "running", "cancelling", "waiting"] as const;

export interface BotRecord {
  id: string;
  workspaceId: string;
  slug: string;
  name: string;
  role: string;
  description: string;
  avatar: string;
  color: string;
  tags: string[];
  templateId: string | null;
  status: BotStatus;
  systemPrompt: string;
  mission: string;
  responsibilities: string[];
  constraints: string[];
  outputPreferences: string;
  workflow: BotWorkflowStep[];
  capabilities: string[];
  runtimeAgentId: string;
  modelConfig: BotModelConfig;
  memoryPolicy: BotMemoryPolicy;
  delegationPolicy: BotDelegationPolicy;
  limits: BotLimits;
  createdAt: string;
  updatedAt: string;
}

/** Stored JSON is re-parsed with defaults, so a row written before a field existed still yields a complete policy. */
export function toBotRecord(row: Bot): BotRecord {
  const parse = <T>(schema: z.ZodType<T>, value: unknown, fallback: T): T => {
    const result = schema.safeParse(value);
    return result.success ? result.data : fallback;
  };
  return {
    id: row.id, workspaceId: row.workspaceId, slug: row.slug, name: row.name, role: row.role, description: row.description,
    avatar: row.avatar, color: row.color, tags: row.tags, templateId: row.templateId,
    status: (["draft", "active", "disabled"].includes(row.status) ? row.status : "disabled") as BotStatus,
    systemPrompt: row.systemPrompt, mission: row.mission, responsibilities: row.responsibilities, constraints: row.constraints,
    outputPreferences: row.outputPreferences,
    workflow: parse(z.array(workflowStepSchema), row.workflow, []),
    capabilities: row.capabilities, runtimeAgentId: row.runtimeAgentId,
    modelConfig: parse(modelConfigSchema, row.modelConfig, {}),
    memoryPolicy: parse(memoryPolicySchema, row.memoryPolicy, memoryPolicySchema.parse({})),
    // A policy that cannot be read must deny, never widen: the fallback names no callers.
    delegationPolicy: parse(delegationPolicySchema, row.delegationPolicy, delegationPolicySchema.parse({ allowedCallers: [] })),
    limits: parse(limitsSchema, row.limits, limitsSchema.parse({})),
    createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
  };
}

export interface ToolGrant { serverId: string; toolName: string; permission: ToolPermission }
export const toGrant = (row: Pick<BotToolPermission, "serverId" | "toolName" | "permission">): ToolGrant => ({
  serverId: row.serverId, toolName: row.toolName, permission: row.permission as ToolPermission,
});

function toJson(value: unknown): Prisma.InputJsonValue { return value as Prisma.InputJsonValue; }

async function uniqueSlug(workspaceId: string, name: string): Promise<string> {
  const base = slugify(name);
  const taken = new Set((await db.bot.findMany({ where: { workspaceId, slug: { startsWith: base } }, select: { slug: true } })).map((row) => row.slug));
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n += 1) if (!taken.has(`${base}-${n}`)) return `${base}-${n}`;
  throw new BotConfigError("could not derive a unique bot slug", 409);
}

/** A bot is only discoverable and dispatchable if its host can actually execute. */
async function assertActivatable(bot: { runtimeAgentId: string; name: string }): Promise<void> {
  const host = await requireBotHost(bot.runtimeAgentId);
  if (!host.executionVerified) {
    throw new BotConfigError(`Host runtime ${host.agentId} has no verified execution contract, so ${bot.name} cannot be activated yet.`, 409);
  }
}

export interface CreateBotExtras {
  /** Explicit, user-confirmed grants. Nothing is granted that is not listed here. */
  toolGrants?: GrantToolInput[];
  skillIds?: string[];
}

export async function createBot(input: CreateBotInput, actorUserId: string, extras: CreateBotExtras = {}): Promise<BotRecord> {
  const parsed = createBotSchema.safeParse(input);
  if (!parsed.success) throw new BotConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
  const data = parsed.data;
  const host = await requireBotHost(data.runtimeAgentId);
  validateBotModelConfig(host.kind, data.modelConfig);
  if (data.status === "active") await assertActivatable(data);
  const grants = (extras.toolGrants ?? []).map((grant) => grantToolSchema.parse(grant));
  await assertGrantsExist(data.workspaceId, grants);
  const slug = await uniqueSlug(data.workspaceId, data.name);

  const row = await db.bot.create({
    data: {
      workspaceId: data.workspaceId, slug, name: data.name, role: data.role, description: data.description,
      avatar: data.avatar, color: data.color, tags: data.tags, templateId: data.templateId ?? null, status: data.status,
      systemPrompt: data.systemPrompt, mission: data.mission, responsibilities: data.responsibilities, constraints: data.constraints,
      outputPreferences: data.outputPreferences, workflow: toJson(data.workflow), capabilities: data.capabilities,
      runtimeAgentId: data.runtimeAgentId, modelConfig: toJson(data.modelConfig), memoryPolicy: toJson(data.memoryPolicy),
      delegationPolicy: toJson(data.delegationPolicy), limits: toJson(data.limits), createdByUserId: actorUserId,
      toolPermissions: { create: grants.map((grant) => ({ ...grant, grantedByUserId: actorUserId })) },
    },
  });
  await writeAuditLog({ workspaceId: row.workspaceId, userId: actorUserId, action: "bot.created", entityType: "Bot", entityId: row.id, details: { name: row.name, templateId: row.templateId, grants: grants.length, status: row.status } });
  if (extras.skillIds?.length) for (const skillId of extras.skillIds) await assignSkill(row.id, skillId, actorUserId);
  return toBotRecord(row);
}

export async function getBotRow(id: string) {
  return db.bot.findUnique({ where: { id }, include: { toolPermissions: true, skills: { include: { skill: true } } } });
}

export async function updateBot(id: string, input: UpdateBotInput, actorUserId: string): Promise<BotRecord> {
  const existing = await db.bot.findUnique({ where: { id } });
  if (!existing) throw new BotConfigError("Bot not found", 404);
  const parsed = updateBotSchema.safeParse(input);
  if (!parsed.success) throw new BotConfigError(parsed.error.issues.map((issue) => `${issue.path.join(".") || "input"}: ${issue.message}`).join("; "));
  const patch = parsed.data;
  const runtimeAgentId = patch.runtimeAgentId ?? existing.runtimeAgentId;
  const host = await requireBotHost(runtimeAgentId);
  const before = toBotRecord(existing);
  if (patch.modelConfig || patch.runtimeAgentId) validateBotModelConfig(host.kind, patch.modelConfig ?? before.modelConfig);
  if ((patch.status ?? existing.status) === "active" && (patch.status || patch.runtimeAgentId)) await assertActivatable({ runtimeAgentId, name: patch.name ?? existing.name });

  const data: Prisma.BotUpdateInput = {};
  for (const key of ["name", "role", "description", "avatar", "color", "tags", "templateId", "systemPrompt", "mission", "responsibilities", "constraints", "outputPreferences", "capabilities", "runtimeAgentId", "status"] as const) {
    if (patch[key] !== undefined) (data as Record<string, unknown>)[key] = patch[key];
  }
  if (patch.workflow !== undefined) data.workflow = toJson(patch.workflow);
  if (patch.modelConfig !== undefined) data.modelConfig = toJson(patch.modelConfig);
  if (patch.memoryPolicy !== undefined) data.memoryPolicy = toJson(patch.memoryPolicy);
  if (patch.delegationPolicy !== undefined) data.delegationPolicy = toJson(patch.delegationPolicy);
  if (patch.limits !== undefined) data.limits = toJson(patch.limits);
  const row = await db.bot.update({ where: { id }, data });
  await writeAuditLog({ workspaceId: row.workspaceId, userId: actorUserId, action: "bot.updated", entityType: "Bot", entityId: id, details: { fields: Object.keys(patch) } });
  return toBotRecord(row);
}

export async function setBotStatus(id: string, status: Exclude<BotStatus, "draft">, actorUserId: string): Promise<BotRecord> {
  return updateBot(id, { status }, actorUserId).then(async (record) => {
    await writeAuditLog({ workspaceId: record.workspaceId, userId: actorUserId, action: status === "active" ? "bot.enabled" : "bot.disabled", entityType: "Bot", entityId: id });
    return record;
  });
}
export const enableBot = (id: string, actorUserId: string) => setBotStatus(id, "active", actorUserId);
export const disableBot = (id: string, actorUserId: string) => setBotStatus(id, "disabled", actorUserId);

export async function deleteBot(id: string, actorUserId: string): Promise<void> {
  const bot = await db.bot.findUnique({ where: { id } });
  if (!bot) throw new BotConfigError("Bot not found", 404);
  const active = await db.orchestrationRun.count({ where: { botId: id, status: { in: [...ACTIVE_RUN_STATUSES] } } });
  if (active > 0) throw new BotConfigError(`${bot.name} has ${active} task(s) in progress. Cancel them or wait before deleting.`, 409);
  await db.bot.delete({ where: { id } });
  await writeAuditLog({ workspaceId: bot.workspaceId, userId: actorUserId, action: "bot.deleted", entityType: "Bot", entityId: id, details: { name: bot.name } });
}

export async function duplicateBot(id: string, actorUserId: string, name?: string): Promise<BotRecord> {
  const source = await getBotRow(id);
  if (!source) throw new BotConfigError("Bot not found", 404);
  const record = toBotRecord(source);
  const copy = await createBot({
    ...record, workspaceId: record.workspaceId, name: (name?.trim() || `${record.name} (copy)`).slice(0, 60), status: "draft",
    // A copy starts unreachable: callers are re-chosen deliberately, not inherited.
    delegationPolicy: { ...record.delegationPolicy, allowedCallers: ["user"] },
  }, actorUserId, {
    toolGrants: source.toolPermissions.map(toGrant),
  });
  for (const link of source.skills) await db.botSkill.create({ data: { botId: copy.id, skillId: link.skillId, enabled: link.enabled, addedByUserId: actorUserId } });
  await writeAuditLog({ workspaceId: copy.workspaceId, userId: actorUserId, action: "bot.duplicated", entityType: "Bot", entityId: copy.id, details: { sourceId: id } });
  return copy;
}

// ------------------------------------------------------------- grants ----

async function assertGrantsExist(workspaceId: string, grants: readonly ToolGrant[]): Promise<void> {
  if (!grants.length) return;
  const catalog = await loadCatalog(workspaceId);
  for (const grant of grants) {
    const server = catalog.find((entry) => entry.id === grant.serverId);
    if (!server) throw new BotConfigError(`Unknown tool server "${grant.serverId}".`);
    if (grant.toolName !== "*" && !server.tools.some((tool) => tool.name === grant.toolName)) {
      throw new BotConfigError(`${server.name} has no tool named "${grant.toolName}". Refresh the server's tools if it changed.`);
    }
  }
}

export async function grantToolPermission(botId: string, input: GrantToolInput, actorUserId: string): Promise<ToolGrant> {
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new BotConfigError("Bot not found", 404);
  const grant = grantToolSchema.parse(input);
  await assertGrantsExist(bot.workspaceId, [grant]);
  const row = await db.botToolPermission.upsert({
    where: { botId_serverId_toolName: { botId, serverId: grant.serverId, toolName: grant.toolName } },
    create: { botId, ...grant, grantedByUserId: actorUserId },
    update: { permission: grant.permission, grantedByUserId: actorUserId },
  });
  await writeAuditLog({ workspaceId: bot.workspaceId, userId: actorUserId, action: "bot.tool_granted", entityType: "Bot", entityId: botId, details: { ...grant } });
  return toGrant(row);
}

export async function revokeToolPermission(botId: string, serverId: string, toolName: string, actorUserId: string): Promise<boolean> {
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new BotConfigError("Bot not found", 404);
  const { count } = await db.botToolPermission.deleteMany({ where: { botId, serverId, toolName } });
  if (count) await writeAuditLog({ workspaceId: bot.workspaceId, userId: actorUserId, action: "bot.tool_revoked", entityType: "Bot", entityId: botId, details: { serverId, toolName } });
  return count > 0;
}

export async function updateMemoryPolicy(botId: string, patch: Partial<z.input<typeof memoryPolicySchema>>, actorUserId: string): Promise<BotMemoryPolicy> {
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new BotConfigError("Bot not found", 404);
  const merged = memoryPolicySchema.safeParse({ ...toBotRecord(bot).memoryPolicy, ...patch });
  if (!merged.success) throw new BotConfigError(merged.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "));
  await db.bot.update({ where: { id: botId }, data: { memoryPolicy: toJson(merged.data) } });
  await writeAuditLog({ workspaceId: bot.workspaceId, userId: actorUserId, action: "bot.memory_policy_updated", entityType: "Bot", entityId: botId, details: { fields: Object.keys(patch) } });
  return merged.data;
}

// ------------------------------------------------------------- skills ----

export interface AssignSkillResult { botId: string; skillId: string; unmetTools: string[] }

/**
 * Only an admin-approved (active) skill in the bot's own workspace can be
 * assigned. `unmetTools` lists tools the skill declares it needs that the bot
 * has no usable grant for — reported, not blocking, because the grant is a
 * separate decision the admin makes.
 */
export async function assignSkill(botId: string, skillId: string, actorUserId: string): Promise<AssignSkillResult> {
  const bot = await db.bot.findUnique({ where: { id: botId }, include: { toolPermissions: true } });
  if (!bot) throw new BotConfigError("Bot not found", 404);
  const skill = await db.skill.findUnique({ where: { id: skillId } });
  if (!skill || skill.workspaceId !== bot.workspaceId) throw new BotConfigError("Skill not found in this workspace", 404);
  if (skill.status !== "active") throw new BotConfigError(`Skill "${skill.name}" is ${skill.status}; it must be reviewed and approved before it can be assigned.`, 409);
  await db.botSkill.upsert({ where: { botId_skillId: { botId, skillId } }, create: { botId, skillId, addedByUserId: actorUserId }, update: { enabled: true } });
  await writeAuditLog({ workspaceId: bot.workspaceId, userId: actorUserId, action: "bot.skill_assigned", entityType: "Bot", entityId: botId, details: { skillId, name: skill.name } });
  const granted = new Set(bot.toolPermissions.filter((row) => row.permission !== "disabled").map((row) => row.toolName));
  const grantedServers = new Set(bot.toolPermissions.filter((row) => row.permission !== "disabled" && row.toolName === "*").map((row) => row.serverId));
  const catalog = await loadCatalog(bot.workspaceId);
  const unmetTools = skill.requiredTools.filter((tool) => {
    if (granted.has(tool)) return false;
    const owner = catalog.find((entry) => entry.tools.some((candidate) => candidate.name === tool));
    return !(owner && grantedServers.has(owner.id));
  });
  return { botId, skillId, unmetTools };
}

export async function removeSkill(botId: string, skillId: string, actorUserId: string): Promise<boolean> {
  const bot = await db.bot.findUnique({ where: { id: botId } });
  if (!bot) throw new BotConfigError("Bot not found", 404);
  const { count } = await db.botSkill.deleteMany({ where: { botId, skillId } });
  if (count) await writeAuditLog({ workspaceId: bot.workspaceId, userId: actorUserId, action: "bot.skill_removed", entityType: "Bot", entityId: botId, details: { skillId } });
  return count > 0;
}

export async function setSkillEnabled(botId: string, skillId: string, enabled: boolean, actorUserId: string): Promise<void> {
  const link = await db.botSkill.findUnique({ where: { botId_skillId: { botId, skillId } }, include: { bot: true } });
  if (!link) throw new BotConfigError("Skill is not assigned to this bot", 404);
  await db.botSkill.update({ where: { id: link.id }, data: { enabled } });
  await writeAuditLog({ workspaceId: link.bot.workspaceId, userId: actorUserId, action: enabled ? "bot.skill_enabled" : "bot.skill_disabled", entityType: "Bot", entityId: botId, details: { skillId } });
}
