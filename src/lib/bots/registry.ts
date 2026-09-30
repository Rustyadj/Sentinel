// The Bot Registry: how agents (and the UI) discover which bot can do a job.
// It is a read model over the bots table — there is no separate registry store to
// drift — and nothing in it names a specific bot. Discovery is filtered by what
// the asker may reach: a caller only sees bots whose delegation policy accepts it.

import { db } from "@/lib/db";
import { readableWorkspaceIds } from "@/lib/knowledge/memory-scope";
import { getRuntimeView } from "@/lib/agents/runtime/service";
import { loadCatalog } from "./catalog";
import { evaluateDelegation, memoryReadScopes, memoryWriteScopes } from "./policy";
import { toBotRecord, toGrant, type BotRecord, type ToolGrant } from "./service";
import { botUsageToday } from "./tasks";
import { ACTIVE_RUN_STATUSES } from "./service";

const STOP = new Set(["a", "an", "and", "the", "for", "to", "of", "in", "on", "with", "that", "this", "make", "create", "please", "need", "want", "can", "you", "me", "my", "our", "is", "it", "at", "by", "from", "showing", "why"]);

export function tokenize(text: string): string[] {
  return [...new Set(text.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3 && !STOP.has(word)))];
}

const stem = (word: string) => word.replace(/(ing|ion|ions|ers|er|es|ed|s)$/, "");
const matches = (haystack: string[], term: string) => haystack.some((word) => word === term || (stem(word).length >= 4 && stem(word) === stem(term)) || (term.length >= 5 && word.startsWith(term)));

export interface RegistryTool { server: string; serverId: string; permission: string; tool: string }

export interface RegistryBot {
  id: string;
  workspaceId: string;
  name: string;
  slug: string;
  role: string;
  description: string;
  capabilities: string[];
  tags: string[];
  skills: { name: string; description: string }[];
  tools: RegistryTool[];
  mcpServers: string[];
  model: { primary: string | null; fast: string | null; reasoning: string | null; vision: string | null };
  memory: { enabled: boolean; read: string[]; write: string[] };
  delegation: { canDelegate: boolean; allowedChildBots: string[] };
  status: string;
  host: { agentId: string; dispatchable: boolean };
  load: { inFlight: number; maxConcurrent: number };
  score?: number;
  matchedOn?: string[];
}

export interface RegistryQuery {
  userId: string;
  /** Restrict to one workspace the user can reach. */
  workspaceId?: string;
  /** Natural-language description of the job. Ranks bots; with no match, none are returned. */
  query?: string;
  capability?: string;
  /** Only bots whose delegation policy accepts this caller. */
  callableBy?: string;
  /** Admin views include draft and disabled bots. */
  includeInactive?: boolean;
  limit?: number;
}

function grantsToTools(grants: ToolGrant[], names: Map<string, string>): RegistryTool[] {
  return grants.filter((grant) => grant.permission !== "disabled").map((grant) => ({
    server: names.get(grant.serverId) ?? grant.serverId, serverId: grant.serverId, permission: grant.permission, tool: grant.toolName,
  }));
}

export async function listRegistryBots(query: RegistryQuery): Promise<RegistryBot[]> {
  const reachable = await readableWorkspaceIds(query.userId);
  const workspaceIds = query.workspaceId ? reachable.filter((id) => id === query.workspaceId) : reachable;
  if (!workspaceIds.length) return [];
  const rows = await db.bot.findMany({
    where: { workspaceId: { in: workspaceIds }, ...(query.includeInactive ? {} : { status: "active" }) },
    include: { toolPermissions: true, skills: { include: { skill: { select: { name: true, description: true, status: true } } } } },
    orderBy: { name: "asc" },
  });
  if (!rows.length) return [];

  const serverNames = new Map<string, string>();
  for (const workspaceId of workspaceIds) for (const server of await loadCatalog(workspaceId)) serverNames.set(server.id, server.name);
  const activeCounts = await db.orchestrationRun.groupBy({ by: ["botId"], where: { botId: { in: rows.map((row) => row.id) }, status: { in: ["queued", "running", "cancelling"] } }, _count: { _all: true } });
  const inFlight = new Map(activeCounts.map((entry) => [entry.botId, entry._count._all]));
  const hosts = new Map<string, boolean>();
  for (const agentId of new Set(rows.map((row) => row.runtimeAgentId))) {
    const host = await getRuntimeView(agentId);
    hosts.set(agentId, Boolean(host?.enabled && host.executionVerified));
  }

  const terms = tokenize(query.query ?? "");
  const results: RegistryBot[] = [];
  for (const row of rows) {
    const bot = toBotRecord(row);
    if (query.callableBy && !evaluateDelegation({ target: { id: bot.id, status: bot.status, delegationPolicy: bot.delegationPolicy }, callerKey: query.callableBy }).allowed) continue;
    if (query.capability && !bot.capabilities.map((item) => item.toLowerCase()).includes(query.capability.toLowerCase())) continue;
    const skills = row.skills.filter((link) => link.enabled && link.skill.status === "active").map((link) => ({ name: link.skill.name, description: link.skill.description }));
    const tools = grantsToTools(row.toolPermissions.map(toGrant), serverNames);
    const entry: RegistryBot = {
      id: bot.id, workspaceId: bot.workspaceId, name: bot.name, slug: bot.slug, role: bot.role, description: bot.description,
      capabilities: bot.capabilities, tags: bot.tags, skills, tools, mcpServers: [...new Set(tools.map((tool) => tool.server))],
      model: { primary: bot.modelConfig.primary ?? null, fast: bot.modelConfig.fast ?? null, reasoning: bot.modelConfig.reasoning ?? null, vision: bot.modelConfig.vision ?? null },
      memory: { enabled: bot.memoryPolicy.enabled, read: memoryReadScopes(bot.memoryPolicy), write: memoryWriteScopes(bot.memoryPolicy) },
      delegation: { canDelegate: bot.delegationPolicy.canDelegate, allowedChildBots: bot.delegationPolicy.allowedChildBots },
      status: bot.status, host: { agentId: bot.runtimeAgentId, dispatchable: hosts.get(bot.runtimeAgentId) ?? false },
      load: { inFlight: inFlight.get(bot.id) ?? 0, maxConcurrent: bot.limits.maxConcurrentTasks },
    };
    if (terms.length) {
      const fields: Array<[string, number, string[]]> = [
        ["capability", 3, bot.capabilities.flatMap(tokenize)],
        ["tag", 2, bot.tags.flatMap(tokenize)],
        ["role", 2, tokenize(bot.role)],
        ["name", 2, tokenize(bot.name)],
        ["description", 1, tokenize(`${bot.description} ${bot.mission}`)],
        ["skill", 1, skills.flatMap((skill) => tokenize(`${skill.name} ${skill.description}`))],
        ["responsibility", 1, bot.responsibilities.flatMap(tokenize)],
      ];
      let score = 0; const matched = new Set<string>();
      for (const term of terms) for (const [label, weight, words] of fields) if (matches(words, term)) { score += weight; matched.add(label); }
      if (score === 0) continue;
      entry.score = score; entry.matchedOn = [...matched];
    }
    results.push(entry);
  }
  results.sort((a, b) => (b.score ?? 0) - (a.score ?? 0) || a.name.localeCompare(b.name));
  return results.slice(0, Math.min(Math.max(query.limit ?? 20, 1), 50));
}

export async function getRegistryBot(userId: string, botId: string, includeInactive = false): Promise<RegistryBot | null> {
  const row = await db.bot.findUnique({ where: { id: botId }, select: { workspaceId: true } });
  if (!row) return null;
  const found = await listRegistryBots({ userId, workspaceId: row.workspaceId, includeInactive, limit: 50 });
  return found.find((bot) => bot.id === botId) ?? null;
}

// ------------------------------------------------------------ UI summary ----

export interface BotSummary {
  bot: BotRecord;
  host: { agentId: string; enabled: boolean; executionVerified: boolean };
  skills: { id: string; name: string; enabled: boolean }[];
  servers: { id: string; name: string; tools: number | "all" }[];
  memory: { enabled: boolean; read: string[]; write: string[] };
  lastActiveAt: string | null;
  currentTask: { id: string; task: string; status: string } | null;
  usageToday: { tokens: number; costUsd: number; pricedTasks: number; tasks: number };
}

export async function listBotSummaries(workspaceIds: string[]): Promise<BotSummary[]> {
  if (!workspaceIds.length) return [];
  const rows = await db.bot.findMany({
    where: { workspaceId: { in: workspaceIds } },
    include: { toolPermissions: true, skills: { include: { skill: { select: { id: true, name: true, status: true } } } } },
    orderBy: [{ status: "asc" }, { name: "asc" }],
  });
  const serverNames = new Map<string, string>();
  for (const workspaceId of workspaceIds) for (const server of await loadCatalog(workspaceId)) serverNames.set(server.id, server.name);
  const summaries: BotSummary[] = [];
  for (const row of rows) {
    const bot = toBotRecord(row);
    const [host, latest, current, usageToday] = await Promise.all([
      getRuntimeView(bot.runtimeAgentId),
      db.orchestrationRun.findFirst({ where: { botId: bot.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
      db.orchestrationRun.findFirst({ where: { botId: bot.id, status: { in: [...ACTIVE_RUN_STATUSES] } }, orderBy: { createdAt: "desc" }, select: { id: true, status: true, request: true } }),
      botUsageToday(bot.id),
    ]);
    const perServer = new Map<string, { tools: number; all: boolean }>();
    for (const grant of row.toolPermissions.filter((entry) => entry.permission !== "disabled")) {
      const entry = perServer.get(grant.serverId) ?? { tools: 0, all: false };
      if (grant.toolName === "*") entry.all = true; else entry.tools += 1;
      perServer.set(grant.serverId, entry);
    }
    summaries.push({
      bot,
      host: { agentId: bot.runtimeAgentId, enabled: Boolean(host?.enabled), executionVerified: Boolean(host?.executionVerified) },
      skills: row.skills.filter((link) => link.skill.status === "active").map((link) => ({ id: link.skill.id, name: link.skill.name, enabled: link.enabled })),
      servers: [...perServer.entries()].map(([id, entry]) => ({ id, name: serverNames.get(id) ?? id, tools: entry.all ? "all" as const : entry.tools })),
      memory: { enabled: bot.memoryPolicy.enabled, read: memoryReadScopes(bot.memoryPolicy), write: memoryWriteScopes(bot.memoryPolicy) },
      lastActiveAt: latest?.createdAt.toISOString() ?? null,
      currentTask: current ? { id: current.id, status: current.status, task: String((current.request as { task?: unknown } | null)?.task ?? "").slice(0, 120) } : null,
      usageToday,
    });
  }
  return summaries;
}
