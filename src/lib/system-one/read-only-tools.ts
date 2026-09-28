/**
 * Per-agent read-only tool connectors for the System 1 fast path.
 *
 * Isolation is structural: a connector is configured under one agent's env
 * namespace (`SENTINEL_AGENT_MCP_HERMES_NATHAN2_URL` / `_TOKEN`) and is only
 * ever resolved for that agent id. Lisa has no way to reach Nathan2's
 * credential — there is no shared catalog to leak through.
 *
 * Eligibility is decided by the tool's own server, not by System 1: only tools
 * annotated `readOnlyHint: true` and not `destructiveHint: true` are listed,
 * and a call is re-checked against that list immediately before it runs. The
 * remote server still authenticates the agent's token and enforces its own
 * scopes, so this path grants nothing the agent's runtime could not already do.
 */
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { logger } from "@/lib/logger";
import { agentEnvSlug } from "./config";
import type { ReadOnlyToolDescriptor } from "./types";

type Env = Readonly<Record<string, string | undefined>>;

const CATALOG_TTL_MS = 10 * 60_000;
const MAX_TOOLS_PER_AGENT = 60;

export interface ConnectorConfig {
  agentId: string;
  name: string;
  url: string;
  token: string;
}

export function resolveAgentConnector(agentId: string, env: Env = process.env): ConnectorConfig | null {
  const prefix = `SENTINEL_AGENT_MCP_${agentEnvSlug(agentId)}`;
  const url = env[`${prefix}_URL`]?.trim();
  const token = env[`${prefix}_TOKEN`]?.trim();
  if (!url || !token) return null;
  try {
    if (new URL(url).protocol !== "https:" && !/^http:\/\/(127\.0\.0\.1|localhost|host\.docker\.internal)[:/]/.test(url)) return null;
  } catch {
    return null;
  }
  return { agentId, name: env[`${prefix}_NAME`]?.trim() || "mcp", url, token };
}

/** The subset of an MCP `tools/list` entry this module reads. */
export interface ListedTool {
  name: string;
  description?: string;
  inputSchema?: { properties?: Record<string, { enum?: unknown[] } & Record<string, unknown>>; required?: string[] };
  annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
}

export function toReadOnlyDescriptors(connector: string, tools: ListedTool[]): ReadOnlyToolDescriptor[] {
  return tools
    .filter((t) => t.annotations?.readOnlyHint === true && t.annotations?.destructiveHint !== true)
    .slice(0, MAX_TOOLS_PER_AGENT)
    .map((t) => {
      const properties = t.inputSchema?.properties ?? {};
      const required = (t.inputSchema?.required ?? []).filter((r) => typeof r === "string");
      const enumArguments: Record<string, string[]> = {};
      for (const [arg, schema] of Object.entries(properties)) {
        const values = Array.isArray(schema?.enum) ? schema.enum.filter((v): v is string => typeof v === "string") : [];
        if (values.length > 0 && values.length <= 255) enumArguments[arg] = values;
      }
      return {
        id: `${connector}.${t.name}`,
        connector,
        name: t.name,
        description: (t.description ?? t.name).slice(0, 300),
        enumArguments,
        requiredArguments: required,
        fastPathEligible: required.every((r) => r in enumArguments),
      };
    });
}

interface CachedConnector {
  config: ConnectorConfig;
  client: Client | null;
  tools: ReadOnlyToolDescriptor[];
  fetchedAt: number;
  pending: Promise<ReadOnlyToolDescriptor[]> | null;
}

const connectors = new Map<string, CachedConnector>();

async function connect(config: ConnectorConfig): Promise<Client> {
  const client = new Client({ name: "sentinel-system-one", version: "1.0.0" });
  await client.connect(new StreamableHTTPClientTransport(new URL(config.url), {
    requestInit: { headers: { Authorization: `Bearer ${config.token}` } },
  }));
  return client;
}

function drop(agentId: string) {
  const entry = connectors.get(agentId);
  void entry?.client?.close().catch(() => {});
  connectors.delete(agentId);
}

/**
 * The read-only tools this agent may be routed to. Cached; an unreachable
 * server yields an empty list (no fast path), never an error.
 */
export async function listReadOnlyTools(agentId: string, env: Env = process.env): Promise<ReadOnlyToolDescriptor[]> {
  const config = resolveAgentConnector(agentId, env);
  if (!config) return [];
  let entry = connectors.get(agentId);
  if (entry && (entry.config.url !== config.url || entry.config.token !== config.token)) {
    drop(agentId);
    entry = undefined;
  }
  if (entry && Date.now() - entry.fetchedAt < CATALOG_TTL_MS) return entry.tools;
  if (entry?.pending) return entry.pending;

  const next: CachedConnector = entry ?? { config, client: null, tools: [], fetchedAt: 0, pending: null };
  connectors.set(agentId, next);
  next.pending = (async () => {
    try {
      next.client ??= await connect(config);
      const listed = await next.client.listTools(undefined, { timeout: 5_000 });
      next.tools = toReadOnlyDescriptors(config.name, listed.tools as ListedTool[]);
      next.fetchedAt = Date.now();
      return next.tools;
    } catch (error) {
      logger.warn("system_one.tools.list_failed", { agentId, connector: config.name, error: error instanceof Error ? error.message : String(error) });
      drop(agentId);
      return [];
    } finally {
      next.pending = null;
    }
  })();
  return next.pending;
}

/**
 * The cached catalog, synchronously, for the request path. A cold or stale
 * cache returns what it has (possibly nothing — no fast path this turn) and
 * refreshes in the background; the request never waits on `tools/list`.
 * Session warm-up is what makes the first spoken request find it hot.
 */
export function peekReadOnlyTools(agentId: string, env: Env = process.env): ReadOnlyToolDescriptor[] {
  const config = resolveAgentConnector(agentId, env);
  if (!config) return [];
  const entry = connectors.get(agentId);
  if (!entry || Date.now() - entry.fetchedAt >= CATALOG_TTL_MS) void listReadOnlyTools(agentId, env);
  return entry && entry.config.url === config.url ? entry.tools : [];
}

export interface ToolCallResult {
  ok: boolean;
  /** Structured content when the server returns it, else the text content. */
  data: unknown;
  latencyMs: number;
  error?: string;
}

/**
 * Executes one read-only tool for one agent. Refuses anything not in that
 * agent's current read-only catalog, whatever the caller was told to run.
 */
export async function callReadOnlyTool(input: {
  agentId: string;
  toolId: string;
  arguments: Record<string, string>;
  signal?: AbortSignal;
  timeoutMs?: number;
}): Promise<ToolCallResult> {
  const startedAt = performance.now();
  const elapsed = () => Math.round(performance.now() - startedAt);
  const tools = await listReadOnlyTools(input.agentId);
  const tool = tools.find((t) => t.id === input.toolId);
  if (!tool) return { ok: false, data: null, latencyMs: elapsed(), error: "tool is not a read-only tool of this agent" };
  // Only enum-constrained values the schema itself lists can be passed.
  for (const [arg, value] of Object.entries(input.arguments)) {
    if (!tool.enumArguments[arg]?.includes(value)) {
      return { ok: false, data: null, latencyMs: elapsed(), error: `argument ${arg} is not an allowed value` };
    }
  }
  const client = connectors.get(input.agentId)?.client;
  if (!client) return { ok: false, data: null, latencyMs: elapsed(), error: "connector unavailable" };
  try {
    const result = await client.callTool(
      { name: tool.name, arguments: input.arguments },
      undefined,
      { signal: input.signal, timeout: input.timeoutMs ?? 8_000 },
    );
    if (result.isError) return { ok: false, data: null, latencyMs: elapsed(), error: "tool reported an error" };
    const text = Array.isArray(result.content)
      ? result.content.map((c) => (c && typeof c === "object" && "text" in c && typeof c.text === "string" ? c.text : "")).join("\n").trim()
      : "";
    return { ok: true, data: result.structuredContent ?? text, latencyMs: elapsed() };
  } catch (error) {
    if (!input.signal?.aborted) drop(input.agentId);
    return { ok: false, data: null, latencyMs: elapsed(), error: error instanceof Error ? error.message.slice(0, 240) : "tool call failed" };
  }
}

/** Test seam. */
export function resetConnectorsForTests() {
  for (const agentId of [...connectors.keys()]) drop(agentId);
}
