import { createHash, randomUUID } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { retrieveAdaptiveContext, getRetrievalTrace } from "@/lib/adaptive-memory/retrieval";
import { proposeMemoryCandidate } from "@/lib/adaptive-memory/memory-candidate-service";
import { createSkillCandidate } from "@/lib/adaptive-memory/skill-refinery";
import { delegateTask, cancelDelegatedRun, getDelegatedRun, listAgentCapabilities, submitRunFeedback } from "@/lib/adaptive-memory/delegation";
import { requireAdaptiveScope } from "@/lib/adaptive-memory/scope";
import { authorizeTrust } from "@/lib/adaptive-memory/trust";
import { emitAdaptiveEvent } from "@/lib/adaptive-memory/event-service";
import { redactSecrets } from "@/lib/adaptive-memory/security";
import { createApproval } from "@/lib/workspaces/approvals";
import { assertClientTenant, authenticateMcp, recordMcpDenial, requireMcpScope, type McpAuthContext } from "./auth";
import { MCP_RESOURCES, MCP_TOOLS } from "./catalog";
import type { ProposeMemoryCandidateInput } from "@/lib/adaptive-memory/types";
import type { SkillCandidateInput } from "@/lib/adaptive-memory/skill-refinery";
import { searchEpisodes } from "@/lib/adaptive-memory/episodic-search";

type JsonRpcRequest = { jsonrpc: "2.0"; id?: string | number | null; method: string; params?: Record<string, unknown> };
const json = (value: unknown) => value as Prisma.InputJsonValue;
const hash = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

function rpcResult(id: JsonRpcRequest["id"], result: unknown) { return { jsonrpc: "2.0", id: id ?? null, result: redactSecrets(result) }; }
function rpcError(id: JsonRpcRequest["id"], code: number, message: string) { return { jsonrpc: "2.0", id: id ?? null, error: { code, message } }; }

async function scopedProject(context: McpAuthContext, projectId: string) {
  assertClientTenant(context, { projectId });
  await requireAdaptiveScope({ actorUserId: context.userId, organizationId: context.organizationId,
    workspaceId: context.workspaceId, projectId, permission: "project.read" });
  return db.project.findUnique({ where: { id: projectId } });
}

async function executeTool(name: string, args: Record<string, unknown>, context: McpAuthContext) {
  assertClientTenant(context, args);
  const workspaceId = args.workspaceId as string | undefined;
  const projectId = args.projectId as string | undefined;
  switch (name) {
    case "sentinel.search_knowledge":
    case "sentinel.retrieve_context":
      return retrieveAdaptiveContext({ ...args, query: String(args.query), userId: context.userId,
        agentId: args.agentId as string | undefined, organizationId: context.organizationId ?? args.organizationId as string | undefined,
        workspaceId: context.workspaceId ?? workspaceId, projectId: context.projectId ?? projectId,
        maxTokens: typeof args.maxTokens === "number" ? args.maxTokens : undefined });
    case "sentinel.get_retrieval_trace": {
      const trace = await getRetrievalTrace(String(args.traceId));
      if (!trace) return null;
      assertClientTenant(context, { organizationId: trace.organizationId, workspaceId: trace.workspaceId, projectId: trace.projectId });
      if (trace.userId && trace.userId !== context.userId) throw new Error("Retrieval trace access denied.");
      return trace;
    }
    case "sentinel.list_projects": {
      if (context.projectId) return [await scopedProject(context, context.projectId)].filter(Boolean);
      if (context.workspaceId) {
        await requireAdaptiveScope({ actorUserId: context.userId, workspaceId: context.workspaceId, permission: "project.read" });
        return db.project.findMany({ where: { workspaceId: context.workspaceId }, orderBy: { updatedAt: "desc" } });
      }
      if (context.organizationId) {
        await requireAdaptiveScope({ actorUserId: context.userId, organizationId: context.organizationId, permission: "project.read" });
        return db.project.findMany({ where: { workspace: { organizationId: context.organizationId } }, orderBy: { updatedAt: "desc" } });
      }
      return db.project.findMany({ where: { userId: context.userId }, orderBy: { updatedAt: "desc" } });
    }
    case "sentinel.get_project": return scopedProject(context, String(args.projectId));
    case "sentinel.list_agents": {
      const scopedWorkspace = context.workspaceId ?? workspaceId;
      if (!scopedWorkspace) throw new Error("workspaceId is required for agent listing.");
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId: scopedWorkspace, permission: "agent.read" });
      return listAgentCapabilities(scopedWorkspace);
    }
    case "sentinel.get_agent_status": {
      const agent = await db.agent.findUnique({ where: { id: String(args.agentId) }, select: { id: true, name: true, role: true, model: true, status: true, skills: true, toolPermissions: true, workspaceId: true } });
      const scopedWorkspace = context.workspaceId ?? workspaceId;
      if (!scopedWorkspace || agent?.workspaceId !== scopedWorkspace) throw new Error("Agent workspace isolation denied.");
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId: scopedWorkspace, permission: "agent.read" });
      return agent;
    }
    case "sentinel.list_skills": {
      await requireAdaptiveScope({ actorUserId: context.userId, organizationId: context.organizationId,
        workspaceId: context.workspaceId, projectId: context.projectId, userId: context.userId,
        permission: "knowledge.read" });
      const candidates = await db.skillCandidate.findMany({ where: {
        status: "active", ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}),
        ...(context.projectId ? { projectId: context.projectId } : {}), promotedSkillId: { not: null },
        ...(context.organizationId ? { organizationId: context.organizationId } : {}),
        ...(!context.organizationId && !context.workspaceId && !context.projectId ? { proposedBy: context.userId } : {}),
      }, select: { promotedSkillId: true } });
      return db.skill.findMany({ where: { id: { in: candidates.flatMap((candidate) => candidate.promotedSkillId ? [candidate.promotedSkillId] : []) }, status: "active" } });
    }
    case "sentinel.get_skill": {
      const skillId = String(args.skillId);
      const admission = await db.skillCandidate.findFirst({ where: { promotedSkillId: skillId,
        ...(context.organizationId ? { organizationId: context.organizationId } : {}),
        ...(context.workspaceId ? { workspaceId: context.workspaceId } : {}), ...(context.projectId ? { projectId: context.projectId } : {}),
        ...(!context.organizationId && !context.workspaceId && !context.projectId ? { proposedBy: context.userId } : {}) } });
      if (!admission) throw new Error("Skill not found in client scope.");
      await requireAdaptiveScope({ actorUserId: context.userId, organizationId: admission.organizationId,
        workspaceId: admission.workspaceId, projectId: admission.projectId, permission: "knowledge.read" });
      return db.skill.findUnique({ where: { id: skillId } }).then(async (skill) => ({ skill, versions: await db.skillVersion.findMany({ where: { skillId }, orderBy: { version: "desc" } }) }));
    }
    case "sentinel.list_workflows":
      await requireAdaptiveScope({ actorUserId: context.userId, organizationId: context.organizationId,
        workspaceId: context.workspaceId, projectId: context.projectId, userId: context.userId, permission: "workflow.read" });
      return db.workflow.findMany({ where: context.projectId ? { projectId: context.projectId } : context.workspaceId ? { workspaceId: context.workspaceId } : context.organizationId ? { organizationId: context.organizationId } : { userId: context.userId } });
    case "sentinel.get_workflow": {
      const workflow = await db.workflow.findUnique({ where: { id: String(args.workflowId) } });
      if (!workflow) return null;
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId: workflow.workspaceId, projectId: workflow.projectId, permission: "workflow.read" });
      return { workflow, runs: await db.workflowRun.findMany({ where: { workflowId: workflow.id }, orderBy: { createdAt: "desc" }, take: 20 }) };
    }
    case "sentinel.list_pending_approvals": {
      const scopedWorkspace = context.workspaceId ?? workspaceId;
      if (!scopedWorkspace) throw new Error("workspaceId is required.");
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId: scopedWorkspace, permission: "approval.read" });
      return db.approvalRequest.findMany({ where: { workspaceId: scopedWorkspace, status: "pending" }, orderBy: { createdAt: "desc" } });
    }
    case "sentinel.get_run": {
      const runId = String(args.runId);
      const delegated = await getDelegatedRun(runId);
      const run = delegated ?? await db.experience.findUnique({ where: { id: runId }, include: { activeMemorySnapshot: true, outcome: true, evaluations: true } });
      if (!run) return null;
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId: run.workspaceId, projectId: run.projectId, permission: "run.read" });
      return run;
    }
    case "sentinel.search_sessions": {
      return searchEpisodes({ query: String(args.query), actorUserId: context.userId,
        organizationId: context.organizationId, workspaceId: context.workspaceId ?? workspaceId,
        projectId: context.projectId ?? projectId });
    }
    case "sentinel.create_memory_candidate": {
      const candidateInput = { ...args, organizationId: context.organizationId ?? args.organizationId as string | undefined,
        workspaceId: context.workspaceId ?? workspaceId, projectId: context.projectId ?? projectId,
        agentId: args.agentId as string | undefined, proposedBy: String(args.proposedBy ?? args.agentId ?? context.userId) } as unknown as ProposeMemoryCandidateInput;
      return proposeMemoryCandidate(candidateInput, context.userId);
    }
    case "sentinel.create_skill_candidate": {
      const skillInput = { ...args, organizationId: context.organizationId ?? args.organizationId as string | undefined,
        workspaceId: context.workspaceId ?? workspaceId, projectId: context.projectId ?? projectId,
        proposedBy: String(args.proposedBy ?? args.agentId ?? context.userId) } as unknown as SkillCandidateInput;
      return createSkillCandidate(skillInput, context.userId);
    }
    case "sentinel.create_note":
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId, projectId, permission: "note.write" });
      return db.obsidianNote.create({ data: { title: String(args.title), content: String(args.content), tags: Array.isArray(args.tags) ? args.tags.map(String) : [], backlinks: [], projectId, userId: context.userId } });
    case "sentinel.create_task":
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId, projectId, permission: "task.create" });
      return db.task.create({ data: { workspaceId, projectId, title: String(args.title), description: args.description ? String(args.description) : undefined, tags: [], priority: String(args.priority ?? "medium") } });
    case "sentinel.update_task": {
      const task = await db.task.findUniqueOrThrow({ where: { id: String(args.taskId) } });
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId: task.workspaceId, projectId: task.projectId, permission: "task.update" });
      return db.task.update({ where: { id: task.id }, data: { title: args.title ? String(args.title) : undefined, description: args.description === null ? null : args.description ? String(args.description) : undefined, status: args.status ? String(args.status) : undefined, priority: args.priority ? String(args.priority) : undefined } });
    }
    case "sentinel.delegate_task":
    case "sentinel.start_agent_run":
      return delegateTask({ requestId: typeof args.requestId === "string" ? args.requestId : undefined,
        actingUserId: context.userId, mcpClientId: context.clientId,
        organizationId: context.organizationId ?? args.organizationId as string | undefined,
        workspaceId: context.workspaceId ?? workspaceId, projectId: context.projectId ?? projectId,
        agentId: String(args.agentId), objective: String(args.objective),
        allowedTools: Array.isArray(args.allowedTools) ? args.allowedTools.map(String) : [],
        maxRuntimeMs: Number(args.maxRuntimeMs ?? 300_000), maxCost: Number(args.maxCost ?? context.maxCostPerRequest ?? 1),
        writePermissions: Array.isArray(args.writePermissions) ? args.writePermissions.map(String) : [],
        approvalPolicy: (args.approvalPolicy ?? {}) as Record<string, unknown>,
        expectedDeliverables: (args.expectedDeliverables ?? {}) as Record<string, unknown>,
        successCriteria: Array.isArray(args.successCriteria) ? args.successCriteria.map(String) : [] });
    case "sentinel.cancel_run": return cancelDelegatedRun(String(args.runId), context.userId);
    case "sentinel.request_approval":
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId: String(args.workspaceId), projectId,
        permission: "approval.create" });
      return createApproval({ workspaceId: String(args.workspaceId), projectId,
        title: String(args.title), description: args.description ? String(args.description) : undefined,
        type: String(args.type ?? "mcp_action"), payload: (args.payload ?? {}) as Record<string, unknown>,
        requesterAgentId: args.agentId ? String(args.agentId) : undefined }, context.userId);
    case "sentinel.run_workflow": {
      const workflow = await db.workflow.findUniqueOrThrow({ where: { id: String(args.workflowId) } });
      await requireAdaptiveScope({ actorUserId: context.userId, workspaceId: workflow.workspaceId, projectId: workflow.projectId, permission: "workflow.run" });
      if (workflow.status !== "active" || workflow.approvalStatus !== "approved" || workflow.disabledAt) throw new Error("Workflow is not approved and active.");
      return db.workflowRun.create({ data: { workflowId: workflow.id, workflowVersion: workflow.version,
        actingUserId: context.userId, operatorAgentId: workflow.operatorAgentId,
        workspaceId: workflow.workspaceId, projectId: workflow.projectId, status: "queued" } });
    }
    case "sentinel.submit_run_feedback": return submitRunFeedback(String(args.runId), context.userId, (args.feedback ?? {}) as Record<string, unknown>);
    case "sentinel.send_agent_message":
    case "sentinel.append_conversation_message": {
      const room = await db.chatRoom.findUniqueOrThrow({ where: { id: String(args.conversationId) }, include: { project: true } });
      if (room.userId !== context.userId) await requireAdaptiveScope({ actorUserId: context.userId, projectId: room.projectId, permission: "message.write" });
      return db.message.create({ data: { chatRoomId: room.id, role: String(args.role ?? "user"), agentId: args.agentId ? String(args.agentId) : undefined, content: String(args.content) } });
    }
    default: throw new Error(`Unknown MCP tool: ${name}`);
  }
}

async function readResource(uri: string, context: McpAuthContext) {
  const parts = new URL(uri).pathname.split("/").filter(Boolean);
  const kind = new URL(uri).hostname;
  if (kind === "organizations" && parts[0]) {
    await requireAdaptiveScope({ actorUserId: context.userId, organizationId: parts[0], permission: "workspace.read" });
    return db.organization.findUnique({ where: { id: parts[0] } });
  }
  if (kind === "workspaces" && parts[0]) {
    await requireAdaptiveScope({ actorUserId: context.userId, organizationId: context.organizationId,
      workspaceId: parts[0], permission: "workspace.read" });
    return db.workspace.findUnique({ where: { id: parts[0] } });
  }
  if (kind === "projects" && parts[0]) return scopedProject(context, parts[0]);
  if (kind === "agents" && parts[0]) return executeTool("sentinel.get_agent_status", { agentId: parts[0] }, context);
  if (kind === "skills" && parts[0]) return executeTool("sentinel.get_skill", { skillId: parts[0] }, context);
  if (kind === "workflows" && parts[0]) return executeTool("sentinel.get_workflow", { workflowId: parts[0] }, context);
  if (kind === "runs" && parts[0]) return executeTool("sentinel.get_run", { runId: parts[0] }, context);
  if (kind === "retrieval-traces" && parts[0]) return executeTool("sentinel.get_retrieval_trace", { traceId: parts[0] }, context);
  if (kind === "conversations" && parts[0]) {
    const room = await db.chatRoom.findUnique({ where: { id: parts[0] }, include: { messages: { orderBy: { createdAt: "asc" }, take: 200 } } });
    if (!room) return null;
    if (room.userId !== context.userId) {
      if (!room.projectId) throw new Error("Conversation access denied.");
      await requireAdaptiveScope({ actorUserId: context.userId, projectId: room.projectId, permission: "message.read" });
    }
    return room;
  }
  if (kind === "knowledge" && parts[0]) {
    const object = await db.knowledgeObject.findUnique({ where: { id: parts[0] } });
    if (!object) return null;
    assertClientTenant(context, { organizationId: object.organizationId, workspaceId: object.workspaceId, projectId: object.projectId });
    await requireAdaptiveScope({ actorUserId: context.userId, organizationId: object.organizationId,
      workspaceId: object.workspaceId, projectId: object.projectId, userId: object.userId, permission: "knowledge.read" });
    return object;
  }
  if (kind === "approvals" && parts[0] === "pending") return executeTool("sentinel.list_pending_approvals", {}, context);
  throw new Error("Unsupported MCP resource URI.");
}

export async function handleMcp(request: Request, body: JsonRpcRequest) {
  let context: McpAuthContext;
  try { context = await authenticateMcp(request); }
  catch (error) { return rpcError(body.id, -32001, error instanceof Error ? error.message : "Authentication failed."); }
  try {
    if (body.jsonrpc !== "2.0") return rpcError(body.id, -32600, "Invalid JSON-RPC version.");
    if (body.method === "initialize") return rpcResult(body.id, { protocolVersion: "2025-03-26", serverInfo: { name: "Sentinel OS", version: "1.0.0" }, capabilities: { tools: {}, resources: {} } });
    if (body.method === "tools/list") return rpcResult(body.id, { tools: MCP_TOOLS.map((tool) => ({ name: tool.name, description: tool.description, inputSchema: tool.inputSchema })) });
    if (body.method === "resources/list") return rpcResult(body.id, { resources: MCP_RESOURCES.map((uri) => ({ uri, name: uri })) });
    if (body.method === "resources/read") {
      requireMcpScope(context, "resources:read");
      const uri = String(body.params?.uri ?? "");
      return rpcResult(body.id, { contents: [{ uri, mimeType: "application/json", text: JSON.stringify(await readResource(uri, context)) }] });
    }
    if (body.method !== "tools/call") return rpcError(body.id, -32601, "Method not found.");
    const name = String(body.params?.name ?? "");
    const definition = MCP_TOOLS.find((tool) => tool.name === name);
    if (!definition) return rpcError(body.id, -32602, "Unknown tool.");
    requireMcpScope(context, definition.scope);
    const args = { ...((body.params?.arguments ?? {}) as Record<string, unknown>) };
    const approvalId = typeof args.approvalId === "string" ? args.approvalId : undefined;
    const trust = authorizeTrust({ configuredLevel: context.trustLevel, operation: name, mutates: definition.mutates, approvalId });
    if (!trust.allowed) throw new Error(trust.reason);
    const idempotencyKey = request.headers.get("idempotency-key") ?? (typeof args.idempotencyKey === "string" ? args.idempotencyKey : undefined);
    if (definition.mutates && !idempotencyKey) throw new Error("Mutation requires an Idempotency-Key.");
    const requestHash = hash({ name, args });
    if (idempotencyKey) {
      const existing = await db.mcpRequest.findFirst({ where: { clientId: context.clientId, idempotencyKey } });
      if (existing) {
        if (existing.requestHash !== requestHash) throw new Error("Idempotency key was reused with a different request.");
        if (existing.response) return existing.response;
        throw new Error("An identical MCP mutation is already in progress.");
      }
    }
    const requestRecord = await db.mcpRequest.create({ data: { clientId: context.clientId,
      requestId: `${String(body.id ?? "notification")}:${randomUUID()}`, idempotencyKey,
      method: body.method, toolName: name, workspaceId: context.workspaceId, projectId: context.projectId,
      status: "started", requestHash } });
    const started = Date.now();
    try {
      const result = rpcResult(body.id, { content: [{ type: "text", text: JSON.stringify(await executeTool(name, args, context)) }] });
      await db.mcpRequest.update({ where: { id: requestRecord.id }, data: { status: "completed", response: json(result), durationMs: Date.now() - started } });
      await emitAdaptiveEvent({ type: "mcp.tool_called", requestId: requestRecord.requestId,
        userId: context.userId, workspaceId: context.workspaceId, projectId: context.projectId,
        durationMs: Date.now() - started, result: "completed", payload: { clientId: context.clientId, toolName: name } });
      return result;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      await db.mcpRequest.update({ where: { id: requestRecord.id }, data: { status: "failed", error: message, durationMs: Date.now() - started } });
      await emitAdaptiveEvent({ type: "mcp.tool_failed", requestId: requestRecord.requestId,
        userId: context.userId, workspaceId: context.workspaceId, projectId: context.projectId,
        durationMs: Date.now() - started, error: message, payload: { clientId: context.clientId, toolName: name } });
      throw error;
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await recordMcpDenial(context, message, String(body.params?.name ?? ""));
    return rpcError(body.id, -32003, message);
  }
}
