import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/lib/db";
import { listRuntimeViews, getRuntimeView } from "@/lib/agents/runtime/service";
import { memoryReadWhere } from "@/lib/knowledge/memoryAccess";
import { cancelOrchestrationRun } from "@/lib/orchestration/executor";
import { createOrchestrationRun } from "@/lib/orchestration/service";
import { resolveScope } from "@/lib/orchestration/scope";
import type { McpScope } from "./oauth";

export interface McpPrincipal {
  userId: string;
  clientId: string;
  externalClientId: string;
  scopes: McpScope[];
}

function requireScope(principal: McpPrincipal, scope: McpScope): void {
  if (!principal.scopes.includes(scope)) throw new Error(`Missing required scope: ${scope}`);
}

function toolResult(data: Record<string, unknown>, message: string) {
  return { structuredContent: data, content: [{ type: "text" as const, text: message }] };
}

async function waitForRun(runId: string, userId: string, timeoutMs: number) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = await db.orchestrationRun.findFirst({ where: { id: runId, userId } });
    if (!run) throw new Error("Task not found.");
    if (["succeeded", "failed", "cancelled"].includes(run.status)) return run;
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  return db.orchestrationRun.findFirstOrThrow({ where: { id: runId, userId } });
}

export function createSentinelMcpServer(principal: McpPrincipal): McpServer {
  const server = new McpServer(
    { name: "sentinel", version: "1.0.0" },
    { instructions: "Use sentinel.route_task for user work. Sentinel resolves project context and selects one worker; never ask for raw commands, credentials, or internal infrastructure details." },
  );

  server.registerTool("sentinel.list_agents", {
    title: "List Sentinel agents",
    description: "List configured Sentinel workers and their declared capabilities. Use when the user asks who is available.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    requireScope(principal, "sentinel.read");
    const agents = (await listRuntimeViews()).map((agent) => ({ id: agent.agentId, model: agent.model, kind: agent.kind, endpoint: agent.endpoint, capabilities: agent.capabilities, executable: Boolean(agent.executable || agent.endpoint), executionVerified: false }));
    return toolResult({ agents }, `Found ${agents.length} configured Sentinel agents.`);
  });

  server.registerTool("sentinel.agent_status", {
    title: "Get Sentinel agent status",
    description: "Return safe configured status for one Sentinel worker.",
    inputSchema: z.object({ agentId: z.string().min(1).max(100) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ agentId }) => {
    requireScope(principal, "sentinel.read");
    const agent = await getRuntimeView(agentId);
    if (!agent) throw new Error("Agent not found.");
    return toolResult({ agent: { id: agent.agentId, enabled: agent.enabled, kind: agent.kind, endpoint: agent.endpoint, executionAdapter: agent.kind, executionVerified: false } }, `${agent.agentId} is ${agent.enabled ? "enabled" : "disabled"}.`);
  });

  server.registerTool("sentinel.memory_search", {
    title: "Search Sentinel memory",
    description: "Search only memory the authenticated Sentinel user may read. Use for prior decisions or project memory.",
    inputSchema: z.object({ query: z.string().min(1).max(200), limit: z.number().int().min(1).max(20).optional(), projectHint: z.string().max(120).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ query, limit = 10, projectHint }) => {
    requireScope(principal, "sentinel.memory.read");
    const scope = await resolveScope(principal.userId, { task: query, projectHint });
    if (projectHint && !scope.projectId) throw new Error("Project could not be resolved within your permitted scope.");
    const access = await memoryReadWhere(principal.userId);
    const memories = await db.memory.findMany({
      where: { AND: [access, ...(scope.projectId ? [{ projectId: scope.projectId, scope: "project" }] : []), { content: { contains: query, mode: "insensitive" } }] },
      select: { id: true, content: true, scope: true, tags: true, source: true, projectId: true, updatedAt: true },
      take: limit,
      orderBy: [{ pinned: "desc" }, { importanceScore: "desc" }, { updatedAt: "desc" }],
    });
    return toolResult({ scope, memories }, `Found ${memories.length} permitted memory result(s).`);
  });

  server.registerTool("sentinel.project_context", {
    title: "Resolve Sentinel project context",
    description: "Resolve a project or workspace from natural language without exposing unrelated projects.",
    inputSchema: z.object({ query: z.string().max(500).optional(), projectHint: z.string().max(120).optional(), workspaceHint: z.string().max(120).optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ query = "", projectHint, workspaceHint }) => {
    requireScope(principal, "sentinel.read");
    const scope = await resolveScope(principal.userId, { task: query, projectHint, workspaceHint });
    return toolResult({ scope }, scope.projectId || scope.workspaceId ? "Resolved permitted Sentinel context." : "No unambiguous permitted context was resolved.");
  });

  server.registerTool("sentinel.route_task", {
    title: "Route work through Sentinel",
    description: "Ask Sentinel to resolve context, choose one suitable worker, and execute or queue work. Do not use for raw shell or infrastructure requests.",
    inputSchema: z.object({ task: z.string().min(1).max(12_000), mode: z.enum(["sync", "async"]).optional(), projectHint: z.string().max(120).optional(), workspaceHint: z.string().max(120).optional(), preferredAgentId: z.string().max(100).optional(), taskType: z.enum(["coding", "review", "debugging", "planning", "research", "support", "construction", "estimating"]).optional(), idempotencyKey: z.string().min(8).max(128).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    requireScope(principal, "sentinel.tasks.write");
    const run = await createOrchestrationRun(input, { userId: principal.userId, externalClientId: principal.externalClientId });
    const completed = input.mode === "sync" ? await waitForRun(run.id, principal.userId, 25_000) : run;
    return toolResult({ task: { id: completed.id, status: completed.status, resolvedAgentId: completed.resolvedAgentId, result: completed.status === "succeeded" ? completed.result : undefined, error: completed.error ?? undefined } }, completed.status === "succeeded" ? "Sentinel completed the task." : `Sentinel task ${completed.id} is ${completed.status}.`);
  });

  server.registerTool("sentinel.get_task", {
    title: "Get Sentinel task status",
    description: "Get the authenticated user's status for a previously started Sentinel task.",
    inputSchema: z.object({ taskId: z.string().min(1).max(100) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ taskId }) => {
    requireScope(principal, "sentinel.tasks.read");
    const run = await db.orchestrationRun.findFirst({ where: { id: taskId, userId: principal.userId }, select: { id: true, status: true, resolvedAgentId: true, error: true, queuedAt: true, startedAt: true, completedAt: true, validation: true } });
    if (!run) throw new Error("Task not found.");
    return toolResult({ task: run }, `Task ${run.id} is ${run.status}.`);
  });

  server.registerTool("sentinel.get_result", {
    title: "Get Sentinel task result",
    description: "Get the validated final result for one completed Sentinel task.",
    inputSchema: z.object({ taskId: z.string().min(1).max(100) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ taskId }) => {
    requireScope(principal, "sentinel.tasks.read");
    const run = await db.orchestrationRun.findFirst({ where: { id: taskId, userId: principal.userId }, include: { artifacts: { select: { id: true, title: true, type: true, mimeType: true, storageUrl: true } } } });
    if (!run) throw new Error("Task not found.");
    return toolResult({ task: { id: run.id, status: run.status, result: run.result, validation: run.validation, error: run.error, artifacts: run.artifacts } }, `Task ${run.id} is ${run.status}.`);
  });

  server.registerTool("sentinel.cancel_task", {
    title: "Cancel Sentinel task",
    description: "Cancel a queued or running task owned by the authenticated Sentinel user.",
    inputSchema: z.object({ taskId: z.string().min(1).max(100) }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ taskId }) => {
    requireScope(principal, "sentinel.tasks.write");
    const cancelled = await cancelOrchestrationRun(taskId, principal.userId);
    if (!cancelled) throw new Error("Task cannot be cancelled or was not found.");
    return toolResult({ taskId, status: "cancelled" }, `Cancelled task ${taskId}.`);
  });
  return server;
}
