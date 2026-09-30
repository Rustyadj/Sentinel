// The tool catalog bots are granted from: Sentinel's own MCP tools, the tools
// Hermes ships natively, and outbound MCP servers an admin has registered.
//
// Sentinel never guesses what a registered server exposes. Its tool list comes
// from a real MCP `tools/list` call (discoverMcpTools) and is stored with the
// time it was fetched; a server that has never been discovered has no tools and
// therefore nothing that can be granted.

import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { slugify } from "./schema";
import type { CatalogServer, CatalogTool } from "./policy";

export const SENTINEL_SERVER_ID = "sentinel";
export const HERMES_BUILTIN_SERVER_ID = "hermes-builtin";

const ro = (name: string, description: string): CatalogTool => ({ name, description, readOnly: true, destructive: false });
const rw = (name: string, description: string, risk: CatalogTool["risk"] = "normal"): CatalogTool => ({ name, description, readOnly: false, destructive: false, risk });

/**
 * Tools on Sentinel's own MCP server (src/lib/integrations/mcp-server.ts). A test
 * lists the live server and fails if this drifts from what it registers.
 */
export const SENTINEL_MCP_TOOLS: CatalogTool[] = [
  ro("sentinel.list_agents", "List Sentinel workers and capabilities."),
  ro("sentinel.agent_status", "Safe status for one Sentinel worker."),
  ro("sentinel.capabilities", "Sentinel's capability summary."),
  ro("sentinel.profile", "The connected Sentinel profile."),
  ro("sentinel.memory_search", "Search memory the user may read."),
  ro("sentinel.project_context", "Resolve the project or workspace to work in."),
  rw("sentinel.route_task", "Route work to a Sentinel worker."),
  ro("sentinel.get_task", "Status of a Sentinel task."),
  ro("sentinel.get_result", "Result of a Sentinel task."),
  rw("sentinel.cancel_task", "Cancel a Sentinel task."),
  ro("sentinel.list_bots", "Discover specialised bots."),
  ro("sentinel.get_bot", "Details of one bot."),
  rw("sentinel.delegate_to_bot", "Delegate a task to a bot."),
  ro("sentinel.get_bot_task_status", "Status of a bot task."),
  rw("sentinel.cancel_bot_task", "Cancel a bot task."),
];

/**
 * Tools Hermes provides itself, as reported by its session_info toolsets. `high`
 * marks the ones that reach around Sentinel's governance: Hermes' own memory
 * store, its own sub-agent spawning, and scheduled jobs that outlive a task.
 */
export const HERMES_BUILTIN_TOOLS: CatalogTool[] = [
  ro("read_file", "Read a file."),
  ro("search_files", "Search files."),
  ro("web_search", "Search the web."),
  ro("web_extract", "Extract a web page."),
  ro("skill_view", "Read a skill."),
  ro("skills_list", "List skills."),
  ro("session_search", "Search past Hermes sessions."),
  ro("todo", "Keep a task list."),
  ro("clarify", "Ask the caller a question."),
  rw("write_file", "Write a file."),
  rw("patch", "Patch a file."),
  rw("terminal", "Run shell commands."),
  rw("execute_code", "Run code."),
  rw("text_to_speech", "Synthesise speech."),
  rw("memory", "Hermes' own persistent memory — bypasses Sentinel's governed memory.", "high"),
  rw("delegate_task", "Spawn a Hermes sub-agent — bypasses Sentinel's delegation policy.", "high"),
  rw("cronjob", "Schedule work that outlives this task.", "high"),
];

export function builtinCatalog(): CatalogServer[] {
  return [
    { id: SENTINEL_SERVER_ID, slug: "sentinel", name: "Sentinel", tools: SENTINEL_MCP_TOOLS },
    { id: HERMES_BUILTIN_SERVER_ID, slug: "hermes", name: "Hermes built-in tools", tools: HERMES_BUILTIN_TOOLS },
  ];
}

function storedTools(value: Prisma.JsonValue): CatalogTool[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return [];
    const tool = entry as Record<string, unknown>;
    if (typeof tool.name !== "string") return [];
    return [{
      name: tool.name,
      description: typeof tool.description === "string" ? tool.description : undefined,
      readOnly: typeof tool.readOnly === "boolean" ? tool.readOnly : null,
      destructive: typeof tool.destructive === "boolean" ? tool.destructive : null,
    }];
  });
}

export interface CatalogEntry extends CatalogServer {
  kind: "sentinel" | "hermes-builtin" | "registered";
  description: string;
  enabled: boolean;
  status: string;
  capabilityTags: string[];
  lastDiscoveredAt: string | null;
  lastError: string | null;
  url?: string;
}

/** Every server and tool a bot in this workspace can be granted. */
export async function loadCatalog(workspaceId: string): Promise<CatalogEntry[]> {
  const registered = await db.mcpServerRegistration.findMany({ where: { workspaceId }, orderBy: { name: "asc" } });
  const [sentinel, hermes] = builtinCatalog();
  return [
    { ...sentinel, kind: "sentinel", description: "Sentinel's own MCP server.", enabled: true, status: "connected", capabilityTags: ["orchestration", "memory"], lastDiscoveredAt: null, lastError: null },
    { ...hermes, kind: "hermes-builtin", description: "Tools the Hermes runtime provides natively.", enabled: true, status: "connected", capabilityTags: [], lastDiscoveredAt: null, lastError: null },
    ...registered.map((row): CatalogEntry => ({
      id: row.id, slug: row.slug, name: row.name, tools: storedTools(row.tools), kind: "registered",
      description: row.description, enabled: row.enabled, status: row.status, capabilityTags: row.capabilityTags,
      lastDiscoveredAt: row.lastDiscoveredAt?.toISOString() ?? null, lastError: row.lastError, url: row.url,
    })),
  ];
}

/** Servers a policy decision may rely on: registered ones only count while enabled. */
export function activeCatalog(entries: readonly CatalogEntry[]): CatalogServer[] {
  return entries.filter((entry) => entry.enabled).map(({ id, slug, name, tools }) => ({ id, slug, name, tools }));
}

// ------------------------------------------------------ registration ----

function isPrivateAddress(address: string): boolean {
  if (isIP(address) === 6) {
    const lower = address.toLowerCase();
    return lower === "::1" || lower.startsWith("fc") || lower.startsWith("fd") || lower.startsWith("fe80") || lower.startsWith("::ffff:127.") || lower.startsWith("::ffff:10.") || lower.startsWith("::ffff:192.168.");
  }
  const [a, b] = address.split(".").map(Number);
  return a === 10 || a === 127 || a === 0 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127);
}

export class McpRegistrationError extends Error {
  constructor(message: string, readonly status = 400) { super(message); this.name = "McpRegistrationError"; }
}

/**
 * A registered URL is fetched from the server, so it is an SSRF vector. Only
 * https to public addresses is accepted unless MCP_CATALOG_ALLOW_PRIVATE=1 (for
 * a deliberately internal server). Hostnames are resolved and every address is
 * checked; a name that later re-resolves elsewhere is not defended against.
 */
export async function assertSafeMcpUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new McpRegistrationError("url is not a valid URL"); }
  const allowPrivate = process.env.MCP_CATALOG_ALLOW_PRIVATE === "1";
  if (url.username || url.password) throw new McpRegistrationError("url must not embed credentials");
  if (url.protocol !== "https:" && !(allowPrivate && url.protocol === "http:")) throw new McpRegistrationError("url must use https");
  if (allowPrivate) return url;
  const host = url.hostname.replace(/^\[|\]$/g, "");
  const addresses = isIP(host) ? [host] : (await lookup(host, { all: true }).catch(() => { throw new McpRegistrationError("url host does not resolve"); })).map((entry) => entry.address);
  if (addresses.some(isPrivateAddress) || host === "localhost") throw new McpRegistrationError("url resolves to a private or loopback address");
  return url;
}

export interface DiscoveredTools { tools: CatalogTool[]; serverName: string | null }

/** Real MCP handshake and `tools/list`. Throws with the transport's own message on failure. */
export async function discoverMcpTools(input: { url: string; authMode: string; secretEnvVar?: string | null }): Promise<DiscoveredTools> {
  const url = await assertSafeMcpUrl(input.url);
  const headers: Record<string, string> = {};
  if (input.authMode === "bearer-env") {
    const secret = input.secretEnvVar ? process.env[input.secretEnvVar] : undefined;
    if (!secret) throw new McpRegistrationError(`environment variable ${input.secretEnvVar ?? "(unset)"} is not set on this server`);
    headers.Authorization = `Bearer ${secret}`;
  }
  const client = new Client({ name: "sentinel-bot-catalog", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(url, { requestInit: { headers } });
  try {
    await client.connect(transport, { timeout: 15_000 });
    const tools: CatalogTool[] = [];
    let cursor: string | undefined;
    do {
      const page = await client.listTools(cursor ? { cursor } : {}, { timeout: 15_000 });
      for (const tool of page.tools) {
        tools.push({
          name: tool.name,
          description: tool.description?.slice(0, 500),
          readOnly: typeof tool.annotations?.readOnlyHint === "boolean" ? tool.annotations.readOnlyHint : null,
          destructive: typeof tool.annotations?.destructiveHint === "boolean" ? tool.annotations.destructiveHint : null,
        });
      }
      cursor = page.nextCursor;
    } while (cursor && tools.length < 500);
    return { tools, serverName: client.getServerVersion()?.name ?? null };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export interface RegisterMcpServerInput {
  workspaceId: string;
  name: string;
  url: string;
  description?: string;
  authMode?: "none" | "bearer-env";
  secretEnvVar?: string | null;
  capabilityTags?: string[];
}

export async function registerMcpServer(input: RegisterMcpServerInput, userId: string) {
  const name = input.name.trim();
  if (!name) throw new McpRegistrationError("name is required");
  const authMode = input.authMode ?? "none";
  if (authMode === "bearer-env" && !/^[A-Z][A-Z0-9_]{1,63}$/.test(input.secretEnvVar ?? "")) {
    throw new McpRegistrationError("secretEnvVar must be an UPPER_SNAKE_CASE environment variable name");
  }
  await assertSafeMcpUrl(input.url);
  const slug = slugify(name);
  if (slug === SENTINEL_SERVER_ID || slug === "hermes") throw new McpRegistrationError(`"${slug}" is reserved`);
  const existing = await db.mcpServerRegistration.findUnique({ where: { workspaceId_slug: { workspaceId: input.workspaceId, slug } } });
  if (existing) throw new McpRegistrationError(`a server named "${slug}" is already registered`, 409);
  const row = await db.mcpServerRegistration.create({
    data: {
      workspaceId: input.workspaceId, slug, name, url: input.url, description: input.description?.trim() ?? "",
      authMode, secretEnvVar: authMode === "bearer-env" ? input.secretEnvVar : null,
      capabilityTags: (input.capabilityTags ?? []).map((tag) => tag.trim().toLowerCase()).filter(Boolean).slice(0, 20),
      createdByUserId: userId,
    },
  });
  await writeAuditLog({ workspaceId: row.workspaceId, userId, action: "bot.mcp_server.registered", entityType: "McpServerRegistration", entityId: row.id, details: { name, url: input.url, authMode } });
  return row;
}

/** Re-run discovery and store the outcome, success or failure, on the row. */
export async function refreshMcpServer(id: string, workspaceId: string, userId: string) {
  const row = await db.mcpServerRegistration.findFirst({ where: { id, workspaceId } });
  if (!row) throw new McpRegistrationError("server not found", 404);
  try {
    const found = await discoverMcpTools(row);
    const updated = await db.mcpServerRegistration.update({
      where: { id },
      data: { tools: found.tools as unknown as Prisma.InputJsonValue, status: "connected", lastDiscoveredAt: new Date(), lastError: null },
    });
    await writeAuditLog({ workspaceId, userId, action: "bot.mcp_server.discovered", entityType: "McpServerRegistration", entityId: id, details: { tools: found.tools.length } });
    return updated;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return db.mcpServerRegistration.update({ where: { id }, data: { status: "error", lastError: message.slice(0, 500), lastDiscoveredAt: new Date() } });
  }
}

export async function setMcpServerEnabled(id: string, workspaceId: string, enabled: boolean, userId: string) {
  const row = await db.mcpServerRegistration.findFirst({ where: { id, workspaceId } });
  if (!row) throw new McpRegistrationError("server not found", 404);
  await writeAuditLog({ workspaceId, userId, action: enabled ? "bot.mcp_server.enabled" : "bot.mcp_server.disabled", entityType: "McpServerRegistration", entityId: id });
  return db.mcpServerRegistration.update({ where: { id }, data: { enabled } });
}

export async function deleteMcpServer(id: string, workspaceId: string, userId: string) {
  const row = await db.mcpServerRegistration.findFirst({ where: { id, workspaceId } });
  if (!row) throw new McpRegistrationError("server not found", 404);
  // Grants naming the server go with it: a permission for a server that no
  // longer exists would otherwise sit in the table, silently meaning nothing.
  await db.$transaction([
    db.botToolPermission.deleteMany({ where: { serverId: id, bot: { workspaceId } } }),
    db.mcpServerRegistration.delete({ where: { id } }),
  ]);
  await writeAuditLog({ workspaceId, userId, action: "bot.mcp_server.deleted", entityType: "McpServerRegistration", entityId: id, details: { name: row.name } });
}
