/**
 * The tool surface Sentinel exposes over MCP.
 *
 * Every tool declares a consent scope. The generic catalog methods are the
 * broad read surface ChatGPT needs: they cover the workspace's projects,
 * documents, notes, workflows, collaboration records, knowledge graph, and
 * runtime inventory without exposing private columns or accepting raw Prisma
 * model names/filters from a client.
 */
import { ToolScopeError } from "./errors";
import { MCP_SCOPES, type McpScope } from "./scopes";
import type { McpPrincipal } from "./oauth";

export interface AgentRecord { id: string; name: string; role: string; description: string; status: string; model: string }
export interface MemoryRecord { id: string; type: string; content: string; tags: string[]; importanceScore: number; createdAt: Date }
export interface TaskRecord { id: string; title: string; description: string | null; status: string; priority: string; agentId: string | null; createdAt: Date }

export const CATALOG_KINDS = [
  "project", "document", "note", "workflow", "team", "role", "permission", "org_chart",
  "organization", "department", "approval", "audit_log", "meeting", "conversation", "decision",
  "artifact", "knowledge", "skill", "experience", "evaluation", "learning_candidate", "reflection",
  "knowledge_gap", "learning_goal", "principle", "eval_suite", "guardian_decision",
  "agent_workspace", "agent_runtime", "workspace_event",
] as const;

export type CatalogKind = (typeof CATALOG_KINDS)[number];

export interface CatalogRecord {
  kind: CatalogKind | "memory" | "task";
  id: string;
  title: string;
  text: string;
  path: string;
  metadata: Record<string, unknown>;
}

export interface WorkspaceOverview {
  workspace: { id: string; name: string; slug: string; description: string | null; kind: string };
  counts: Record<string, number>;
}

/** Exactly the reads and writes MCP tools may perform. */
export interface McpDataSource {
  getWorkspaceOverview(input: { workspaceId: string | null; userId: string }): Promise<WorkspaceOverview | null>;
  listCatalogRecords(input: {
    workspaceId: string | null;
    userId: string;
    kind?: CatalogKind;
    query?: string;
    limit: number;
  }): Promise<CatalogRecord[]>;
  getCatalogRecord(input: {
    workspaceId: string | null;
    userId: string;
    kind: CatalogRecord["kind"];
    id: string;
  }): Promise<CatalogRecord | null>;
  listAgents(input: { workspaceId: string | null; limit: number }): Promise<AgentRecord[]>;
  searchMemories(input: { workspaceId: string | null; userId: string; query: string; limit: number }): Promise<MemoryRecord[]>;
  listTasks(input: { workspaceId: string | null; status?: string; limit: number }): Promise<TaskRecord[]>;
  createTask(input: { workspaceId: string | null; title: string; description?: string; priority?: string }): Promise<TaskRecord>;
  getTask(input: { workspaceId: string | null; id: string }): Promise<TaskRecord | null>;
  getMemory(input: { workspaceId: string | null; userId: string; id: string }): Promise<MemoryRecord | null>;
}

export interface ToolContext {
  principal: McpPrincipal;
  data: McpDataSource;
  baseUrl: string;
}

export interface McpTool {
  name: string;
  title: string;
  description: string;
  scope: McpScope;
  inputSchema: Record<string, unknown>;
  annotations: {
    readOnlyHint: boolean;
    destructiveHint: boolean;
    idempotentHint: boolean;
    openWorldHint: boolean;
  };
  handler(args: Record<string, unknown>, ctx: ToolContext): Promise<unknown>;
}

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
const WRITE = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

function str(args: Record<string, unknown>, key: string, fallback = ""): string {
  const value = args[key];
  return typeof value === "string" ? value : fallback;
}

function limit(args: Record<string, unknown>, fallback = 20, max = 100): number {
  const value = args.limit;
  if (typeof value !== "number" || !Number.isFinite(value)) return fallback;
  return Math.min(Math.max(Math.trunc(value), 1), max);
}

function catalogKind(value: string): CatalogKind | undefined {
  return (CATALOG_KINDS as readonly string[]).includes(value) ? value as CatalogKind : undefined;
}

function absoluteUrl(baseUrl: string, path: string): string {
  return new URL(path, `${baseUrl}/`).toString();
}

export const MCP_TOOLS: McpTool[] = [
  {
    name: "search",
    title: "Search Sentinel",
    description: "Search all readable records in the selected Sentinel workspace. Returns ids that can be passed to `fetch` for full content.",
    scope: MCP_SCOPES.searchRead,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text search query." },
        limit: { type: "number", description: "Maximum results (default 20, max 100)." },
      },
      required: ["query"],
    },
    annotations: READ_ONLY,
    async handler(args, ctx) {
      const query = str(args, "query").trim();
      if (!query) return { results: [] };
      const records = await ctx.data.listCatalogRecords({
        workspaceId: ctx.principal.workspaceId,
        userId: ctx.principal.userId,
        query,
        limit: limit(args),
      });
      return { results: records.map((record) => ({ id: `${record.kind}:${record.id}`, title: record.title, url: absoluteUrl(ctx.baseUrl, record.path) })) };
    },
  },
  {
    name: "fetch",
    title: "Fetch a Sentinel record",
    description: "Resolve an id returned by `search` into full text and metadata, still restricted to the selected workspace.",
    scope: MCP_SCOPES.searchRead,
    inputSchema: {
      type: "object",
      properties: { id: { type: "string", description: "An id from a `search` result, such as document:abc." } },
      required: ["id"],
    },
    annotations: READ_ONLY,
    async handler(args, ctx) {
      const compoundId = str(args, "id");
      const separator = compoundId.indexOf(":");
      if (separator < 1) throw new Error(`Unrecognized id "${compoundId}". Use an id returned by search.`);
      const kind = compoundId.slice(0, separator) as CatalogRecord["kind"];
      const id = compoundId.slice(separator + 1);
      const allowedKinds = [...CATALOG_KINDS, "memory", "task"] as const;
      if (!(allowedKinds as readonly string[]).includes(kind)) throw new Error(`Unrecognized record kind "${kind}".`);
      const record = await ctx.data.getCatalogRecord({ workspaceId: ctx.principal.workspaceId, userId: ctx.principal.userId, kind, id });
      if (!record) throw new Error(`No readable ${kind} record with id ${id} exists in this workspace.`);
      return {
        id: compoundId,
        title: record.title,
        text: record.text,
        url: absoluteUrl(ctx.baseUrl, record.path),
        metadata: { kind: record.kind, ...record.metadata },
      };
    },
  },
  {
    name: "sentinel_workspace_overview",
    title: "Get workspace overview",
    description: "Return the selected Sentinel workspace and counts for every major record type available through this connector.",
    scope: MCP_SCOPES.workspaceRead,
    inputSchema: { type: "object", properties: {} },
    annotations: READ_ONLY,
    async handler(_args, ctx) {
      const overview = await ctx.data.getWorkspaceOverview({ workspaceId: ctx.principal.workspaceId, userId: ctx.principal.userId });
      if (!overview) throw new Error("The authorized workspace no longer exists or is not accessible.");
      return overview;
    },
  },
  {
    name: "sentinel_list_content",
    title: "List workspace content",
    description: "List one class of workspace-scoped Sentinel records, including content, collaboration, governance, learning, knowledge, organization, and agent runtime data.",
    scope: MCP_SCOPES.contentRead,
    inputSchema: {
      type: "object",
      properties: {
        kind: { type: "string", enum: CATALOG_KINDS, description: "The record class to list." },
        query: { type: "string", description: "Optional title/content filter." },
        limit: { type: "number", description: "Maximum records (default 20, max 100)." },
      },
      required: ["kind"],
    },
    annotations: READ_ONLY,
    async handler(args, ctx) {
      const kind = catalogKind(str(args, "kind"));
      if (!kind) throw new Error(`kind must be one of: ${CATALOG_KINDS.join(", ")}.`);
      const records = await ctx.data.listCatalogRecords({
        workspaceId: ctx.principal.workspaceId,
        userId: ctx.principal.userId,
        kind,
        query: str(args, "query").trim() || undefined,
        limit: limit(args),
      });
      return {
        kind,
        records: records.map((record) => ({
          id: `${record.kind}:${record.id}`,
          title: record.title,
          preview: record.text.length > 1000 ? `${record.text.slice(0, 997)}...` : record.text,
          url: absoluteUrl(ctx.baseUrl, record.path),
          metadata: record.metadata,
        })),
      };
    },
  },
  {
    name: "sentinel_list_agents",
    title: "List agents",
    description: "List the Sentinel agents available in the authorized workspace, with their roles and status.",
    scope: MCP_SCOPES.agentsRead,
    inputSchema: { type: "object", properties: { limit: { type: "number", description: "Max agents to return (default 20)." } } },
    annotations: READ_ONLY,
    async handler(args, ctx) {
      return { agents: await ctx.data.listAgents({ workspaceId: ctx.principal.workspaceId, limit: limit(args) }) };
    },
  },
  {
    name: "sentinel_search_memories",
    title: "Search memories",
    description: "Search memories attached to projects in the selected workspace.",
    scope: MCP_SCOPES.memoriesRead,
    inputSchema: {
      type: "object",
      properties: {
        query: { type: "string", description: "Free-text query." },
        limit: { type: "number", description: "Max memories to return (default 20)." },
      },
      required: ["query"],
    },
    annotations: READ_ONLY,
    async handler(args, ctx) {
      return { memories: await ctx.data.searchMemories({ workspaceId: ctx.principal.workspaceId, userId: ctx.principal.userId, query: str(args, "query"), limit: limit(args) }) };
    },
  },
  {
    name: "sentinel_list_tasks",
    title: "List tasks",
    description: "List tasks in the authorized workspace, optionally filtered by status.",
    scope: MCP_SCOPES.tasksRead,
    inputSchema: {
      type: "object",
      properties: {
        status: { type: "string", description: "Filter by status, e.g. backlog, in_progress, done." },
        limit: { type: "number", description: "Max tasks to return (default 20)." },
      },
    },
    annotations: READ_ONLY,
    async handler(args, ctx) {
      const status = str(args, "status") || undefined;
      return { tasks: await ctx.data.listTasks({ workspaceId: ctx.principal.workspaceId, status, limit: limit(args) }) };
    },
  },
  {
    name: "sentinel_create_task",
    title: "Create a task",
    description: "Create a task in the authorized workspace. Requires the tasks.write scope.",
    scope: MCP_SCOPES.tasksWrite,
    inputSchema: {
      type: "object",
      properties: {
        title: { type: "string", description: "Short task title." },
        description: { type: "string", description: "Optional longer description." },
        priority: { type: "string", enum: ["low", "medium", "high"], description: "Task priority (default medium)." },
      },
      required: ["title"],
    },
    annotations: WRITE,
    async handler(args, ctx) {
      const title = str(args, "title").trim();
      if (!title) throw new Error("title is required.");
      const priority = str(args, "priority") || "medium";
      if (!["low", "medium", "high"].includes(priority)) throw new Error("priority must be low, medium, or high.");
      const task = await ctx.data.createTask({
        workspaceId: ctx.principal.workspaceId,
        title: title.slice(0, 300),
        description: str(args, "description") || undefined,
        priority,
      });
      return { task };
    },
  },
];

export function findTool(name: string): McpTool | undefined {
  return MCP_TOOLS.find((tool) => tool.name === name);
}

export function toolsVisibleTo(principal: McpPrincipal): McpTool[] {
  return MCP_TOOLS.filter((tool) => principal.scopes.includes(tool.scope));
}

export async function callTool(tool: McpTool, args: Record<string, unknown>, ctx: ToolContext): Promise<unknown> {
  if (!ctx.principal.scopes.includes(tool.scope)) throw new ToolScopeError(tool.scope);
  return tool.handler(args, ctx);
}
