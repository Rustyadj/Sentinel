import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import { db } from "@/lib/db";
import { listAgentCapabilityDescriptors } from "@/lib/agents/capability-descriptor";
import { memoryReadWhere } from "@/lib/knowledge/memoryAccess";
import { excludeFromRetrieval } from "@/lib/learning/memory-governance";
import { recordMemoryRetrieval } from "@/lib/neural-engine/memory-usage-service";
import { cancelOrchestrationRun } from "@/lib/orchestration/executor";
import { createOrchestrationRun } from "@/lib/orchestration/service";
import { resolveScope } from "@/lib/orchestration/scope";
import { listPermittedContext, resolveMcpContext } from "@/lib/integrations/mcp-context";
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
    const agents = await listAgentCapabilityDescriptors(principal.userId);
    return toolResult({ agents }, `Found ${agents.length} configured Sentinel agents.`);
  });

  server.registerTool("sentinel.agent_status", {
    title: "Get Sentinel agent status",
    description: "Return safe configured status for one Sentinel worker.",
    inputSchema: z.object({ agentId: z.string().min(1).max(100) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ agentId }) => {
    requireScope(principal, "sentinel.read");
    const agent = (await listAgentCapabilityDescriptors(principal.userId)).find((candidate) => candidate.id === agentId);
    if (!agent) throw new Error("Agent not found.");
    const status = !agent.reachable ? "unreachable" : !agent.authenticated ? "reachable_not_authenticated" : agent.executable ? "available" : "not_execution_verified";
    return toolResult({ agent: { ...agent, status } }, `${agent.name} is ${status.replaceAll("_", " ")}.`);
  });

  server.registerTool("sentinel.capabilities", {
    title: "Describe Sentinel capabilities",
    description: "Return Sentinel's safe MCP capability summary and current agent availability without exposing credentials or infrastructure details.",
    inputSchema: z.object({}),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async () => {
    requireScope(principal, "sentinel.read");
    const agents = await listAgentCapabilityDescriptors(principal.userId);
    return toolResult({
      version: "1.0.0",
      capabilities: {
        context: ["permitted choices", "explicit project/workspace ids", "durable task context", "unambiguous inference"],
        memory: ["governed broader search", "project filter", "workspace filter", "provenance"],
        tasks: ["single-agent routing", "durable status", "verified results", "owned cancellation"],
        authentication: ["OAuth authorization code", "PKCE S256", "refresh rotation", "resource-bound tokens"],
      },
      agents,
    }, `Sentinel exposes governed context, memory, and durable task execution through ${agents.length} configured agents.`);
  });

  server.registerTool("sentinel.profile", {
    title: "Get connected Sentinel profile",
    description: "Return the stable Sentinel profile represented by the current OAuth credentials.",
    inputSchema: z.object({}),
    outputSchema: z.object({ id: z.string().min(1), name: z.string().optional(), email: z.string().optional() }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    _meta: { "openai/profile": true },
  }, async () => {
    requireScope(principal, "sentinel.read");
    const user = await db.user.findUnique({ where: { id: principal.userId }, select: { id: true, name: true, email: true } });
    if (!user) throw new Error("The authenticated Sentinel profile no longer exists.");
    const profile = { id: user.id, ...(user.name ? { name: user.name } : {}), email: user.email };
    return toolResult(profile, JSON.stringify(profile));
  });

  server.registerTool("sentinel.memory_search", {
    title: "Search Sentinel memory",
    description: "Search only memory the authenticated Sentinel user may read. Use for prior decisions or project memory.",
    inputSchema: z.object({
      query: z.string().min(1).max(200),
      limit: z.number().int().min(1).max(20).optional(),
      projectHint: z.string().max(120).optional(),
      projectId: z.string().max(100).optional(),
      workspaceId: z.string().max(100).optional(),
      contextTaskId: z.string().max(100).optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ query, limit = 10, projectHint, projectId, workspaceId, contextTaskId }) => {
    requireScope(principal, "sentinel.memory.read");
    // Narrowing to a project is optional. Without one this searches everything
    // the user may read, which is the common case and must not be blocked.
    let scope = { projectId: null, projectName: null, workspaceId: null, workspaceName: null, resolution: "none" } as Awaited<ReturnType<typeof resolveScope>>;
    if (projectHint || projectId || workspaceId || contextTaskId) {
      const resolved = await resolveMcpContext(principal.userId, { query, projectHint, projectId, workspaceId, contextTaskId });
      if (!resolved.scope.projectId && !resolved.scope.workspaceId) {
        // Previously this threw "Project could not be resolved within your
        // permitted scope", which told the model nothing it could act on.
        // Hand back the permitted choices instead.
        const choices = resolved.choices?.projects ?? [];
        throw new Error(
          `${resolved.reason} ${choices.length > 0
            ? `Permitted projects: ${choices.map((project) => `${project.name} (${project.id})`).join(", ")}. Retry with projectId.`
            : "Retry without projectHint/projectId to search all memory this user may read."}`,
        );
      }
      scope = resolved.scope;
    }
    const access = await memoryReadWhere(principal.userId);
    const workspaceProjects = scope.workspaceId && !scope.projectId
      ? (await listPermittedContext(principal.userId)).projects
          .filter((project) => project.workspaceId === scope.workspaceId)
          .map((project) => project.id)
      : null;
    const memories = await db.memory.findMany({
      where: {
        AND: [
          access,
          // Governance states are not a scope. Quarantined and forgotten
          // memories were previously reachable through this tool: it queried
          // the table directly and so bypassed the exclusion that every
          // in-product retrieval path applies. An external MCP client could
          // therefore be served memory Sentinel had already judged unsafe or
          // retired. MCP exposes Sentinel's memory policy — it does not get
          // its own.
          excludeFromRetrieval(),
          { archived: false },
          ...(scope.projectId ? [{ projectId: scope.projectId, scope: "project" }] : []),
          ...(workspaceProjects ? [{ projectId: { in: workspaceProjects }, scope: "project" }] : []),
          { content: { contains: query, mode: "insensitive" as const } },
        ],
      },
      select: { id: true, content: true, scope: true, tags: true, source: true, projectId: true, updatedAt: true },
      take: limit,
      // valueScore is the decay policy's output; ranking by it here is what
      // makes decay mean the same thing to an external client as it does in
      // chat. Nulls last, so unscored memories fall behind scored ones.
      orderBy: [
        { pinned: "desc" },
        { valueScore: { sort: "desc" as const, nulls: "last" as const } },
        { importanceScore: "desc" },
        { updatedAt: "desc" },
      ],
    });
    // Reading memory through MCP is a real retrieval and is recorded as one,
    // so external usage feeds the same value signal as in-product usage.
    // `injected` is deliberately left false: Sentinel handed these to a client
    // and cannot observe whether that client put them in front of a model.
    await recordMemoryRetrieval({
      memoryIds: memories.map((memory) => memory.id),
      consumer: "mcp",
      userId: principal.userId,
      projectId: scope.projectId,
    });
    return toolResult({ scope, memories }, `Found ${memories.length} permitted memory result(s).`);
  });

  server.registerTool("sentinel.project_context", {
    title: "Resolve Sentinel project context",
    description:
      "Resolve the Sentinel project or workspace to work in, without exposing anything the user cannot access. " +
      "Call with no arguments to list every permitted project and workspace with their ids. " +
      "Pass projectId or workspaceId to select one exactly; projectHint/workspaceHint/query match by name instead. " +
      "When the result has no projectId or workspaceId, read `choices` and call again with an explicit id.",
    inputSchema: z.object({
      query: z.string().max(500).optional(),
      projectHint: z.string().max(120).optional(),
      workspaceHint: z.string().max(120).optional(),
      projectId: z.string().max(100).optional(),
      workspaceId: z.string().max(100).optional(),
      contextTaskId: z.string().max(100).optional(),
    }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ query = "", projectHint, workspaceHint, projectId, workspaceId, contextTaskId }) => {
    requireScope(principal, "sentinel.read");
    const resolved = await resolveMcpContext(principal.userId, { query, projectHint, workspaceHint, projectId, workspaceId, contextTaskId });
    return toolResult(
      { scope: resolved.scope, ...(resolved.choices ? { choices: resolved.choices } : {}) },
      resolved.reason,
    );
  });

  server.registerTool("sentinel.route_task", {
    title: "Route work through Sentinel",
    description: "Ask Sentinel to resolve context, choose one suitable worker, and execute or queue work. Do not use for raw shell or infrastructure requests.",
    inputSchema: z.object({ task: z.string().min(1).max(12_000), mode: z.enum(["sync", "async"]).optional(), projectId: z.string().max(100).optional(), workspaceId: z.string().max(100).optional(), contextTaskId: z.string().max(100).optional(), projectHint: z.string().max(120).optional(), workspaceHint: z.string().max(120).optional(), preferredAgentId: z.string().max(100).optional(), taskType: z.enum(["coding", "review", "debugging", "planning", "research", "support", "construction", "estimating"]).optional(), idempotencyKey: z.string().min(8).max(128).optional() }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async (input) => {
    requireScope(principal, "sentinel.tasks.write");
    const run = await createOrchestrationRun(input, { userId: principal.userId, externalClientId: principal.externalClientId });
    const completed = input.mode === "sync" ? await waitForRun(run.id, principal.userId, 25_000) : run;
    return toolResult({ task: { id: completed.id, status: completed.status, projectId: completed.projectId, workspaceId: completed.workspaceId, resolvedAgentId: completed.resolvedAgentId, result: completed.status === "succeeded" ? completed.result : undefined, error: completed.error ?? undefined } }, completed.status === "succeeded" ? "Sentinel completed the task." : `Sentinel task ${completed.id} is ${completed.status}.`);
  });

  server.registerTool("sentinel.get_task", {
    title: "Get Sentinel task status",
    description: "Get the authenticated user's status for a previously started Sentinel task.",
    inputSchema: z.object({ taskId: z.string().min(1).max(100) }),
    annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
  }, async ({ taskId }) => {
    requireScope(principal, "sentinel.tasks.read");
    const run = await db.orchestrationRun.findFirst({ where: { id: taskId, userId: principal.userId }, select: { id: true, status: true, projectId: true, workspaceId: true, resolvedAgentId: true, error: true, queuedAt: true, startedAt: true, completedAt: true, validation: true } });
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
    return toolResult({ task: { id: run.id, status: run.status, projectId: run.projectId, workspaceId: run.workspaceId, result: run.result, validation: run.validation, error: run.error, artifacts: run.artifacts } }, `Task ${run.id} is ${run.status}.`);
  });

  server.registerTool("sentinel.cancel_task", {
    title: "Cancel Sentinel task",
    description: "Cancel a queued or running task owned by the authenticated Sentinel user.",
    inputSchema: z.object({ taskId: z.string().min(1).max(100) }),
    annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
  }, async ({ taskId }) => {
    requireScope(principal, "sentinel.tasks.write");
    const cancellation = await cancelOrchestrationRun(taskId, principal.userId);
    if (!cancellation) throw new Error("Task cannot be cancelled or was not found.");
    const message = cancellation.status === "cancelled" ? `Cancelled queued task ${taskId}.` : `Cancellation requested for task ${taskId}; Sentinel will confirm once the executing runtime acknowledges it.`;
    return toolResult({ taskId, projectId: cancellation.projectId, workspaceId: cancellation.workspaceId, status: cancellation.status, acknowledged: cancellation.status === "cancelled" }, message);
  });
  return server;
}
