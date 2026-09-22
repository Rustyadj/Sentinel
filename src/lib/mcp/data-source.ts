/**
 * The live MCP data source. Every query is anchored to the workspace in the
 * OAuth grant; direct-id fetches use the same filters as list/search.
 */
import { db } from "@/lib/db";
import { CATALOG_KINDS, type CatalogKind, type CatalogRecord, type McpDataSource } from "./tools";

function text(...parts: unknown[]): string {
  return parts
    .filter((part) => part !== null && part !== undefined && part !== "")
    .map((part) => typeof part === "string" ? part : JSON.stringify(part, null, 2))
    .join("\n\n");
}

function contains(query?: string) {
  return query ? { contains: query, mode: "insensitive" as const } : undefined;
}

async function projectIdsForWorkspace(workspaceId: string): Promise<string[]> {
  const projects = await db.project.findMany({ where: { workspaceId }, select: { id: true } });
  return projects.map((project) => project.id);
}

/** Re-evaluated on every MCP request so removing workspace access is immediate. */
export async function canUseMcpWorkspace(userId: string, workspaceId: string | null): Promise<boolean> {
  if (!workspaceId) return false;
  return Boolean(await db.workspace.findFirst({
    where: {
      id: workspaceId,
      enabled: true,
      OR: [
        { ownerId: userId },
        {
          roleAssignments: {
            some: {
              userId,
              OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
            },
          },
        },
      ],
    },
    select: { id: true },
  }));
}

async function catalogForKind(
  kind: CatalogKind,
  input: { workspaceId: string; userId: string; query?: string; limit: number; id?: string; projectIds?: string[] },
): Promise<CatalogRecord[]> {
  const { workspaceId, query, limit, id } = input;
  const projectIds = input.projectIds ?? await projectIdsForWorkspace(workspaceId);
  const titleQuery = contains(query);

  switch (kind) {
    case "project": {
      const rows = await db.project.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ name: titleQuery }, { description: titleQuery }, { tags: { has: query } }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, name: true, description: true, status: true, tags: true, agents: true, teamId: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: text(row.description, `Status: ${row.status}`, row.tags.length ? `Tags: ${row.tags.join(", ")}` : ""), path: `/projects?project=${row.id}`, metadata: { status: row.status, tags: row.tags, agentIds: row.agents, teamId: row.teamId, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "document": {
      const rows = await db.document.findMany({
        where: { AND: [{ OR: [{ workspaceId }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] }, ...(query ? [{ OR: [{ title: titleQuery }, { content: titleQuery }, { tags: { has: query } }] }] : [])], ...(id ? { id } : {}) },
        orderBy: [{ pinned: "desc" }, { updatedAt: "desc" }], take: limit,
        select: { id: true, title: true, content: true, type: true, tags: true, pinned: true, version: true, projectId: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.title, text: row.content, path: `/files?document=${row.id}`, metadata: { type: row.type, tags: row.tags, pinned: row.pinned, version: row.version, projectId: row.projectId, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "note": {
      if (!projectIds.length) return [];
      const rows = await db.obsidianNote.findMany({
        where: { projectId: { in: projectIds }, ...(id ? { id } : {}), ...(query ? { OR: [{ title: titleQuery }, { content: titleQuery }, { tags: { has: query } }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, title: true, content: true, tags: true, backlinks: true, projectId: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.title, text: row.content, path: `/obsidian?note=${row.id}`, metadata: { tags: row.tags, backlinks: row.backlinks, projectId: row.projectId, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "workflow": {
      if (!projectIds.length) return [];
      const rows = await db.workflow.findMany({
        where: { projectId: { in: projectIds }, ...(id ? { id } : {}), ...(query ? { OR: [{ name: titleQuery }, { description: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, name: true, description: true, nodes: true, edges: true, status: true, projectId: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: text(row.description, { nodes: row.nodes, edges: row.edges }), path: `/workflows?workflow=${row.id}`, metadata: { status: row.status, projectId: row.projectId, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "team": {
      const rows = await db.team.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ name: titleQuery }, { description: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, name: true, description: true, memberUserIds: true, memberAgentIds: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: row.description ?? "", path: `/workspaces?team=${row.id}`, metadata: { memberUserIds: row.memberUserIds, memberAgentIds: row.memberAgentIds, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "role": {
      const rows = await db.role.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ name: titleQuery }, { description: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, name: true, description: true, system: true, createdAt: true, updatedAt: true, permissions: { select: { key: true, resource: true, action: true } } },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: text(row.description, { permissions: row.permissions }), path: `/security?role=${row.id}`, metadata: { system: row.system, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "permission": {
      const rows = await db.permission.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ key: titleQuery }, { resource: titleQuery }, { action: titleQuery }, { description: titleQuery }] } : {}) },
        orderBy: { key: "asc" }, take: limit,
        select: { id: true, key: true, resource: true, action: true, description: true, createdAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.key, text: text(row.description, `${row.action} ${row.resource}`), path: `/security?permission=${row.id}`, metadata: { resource: row.resource, action: row.action, createdAt: row.createdAt } }));
    }
    case "org_chart": {
      const rows = await db.orgChart.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { name: titleQuery } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, name: true, nodes: true, edges: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: text({ nodes: row.nodes, edges: row.edges }), path: `/orgchart?chart=${row.id}`, metadata: { createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "organization": {
      const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
      if (!workspace?.organizationId) return [];
      const rows = await db.organization.findMany({
        where: { id: id ?? workspace.organizationId, ...(query ? { OR: [{ name: titleQuery }, { description: titleQuery }] } : {}) },
        take: limit,
        select: { id: true, name: true, description: true, settings: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: text(row.description, row.settings), path: `/orgchart?organization=${row.id}`, metadata: { createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "department": {
      const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { organizationId: true } });
      if (!workspace?.organizationId) return [];
      const rows = await db.department.findMany({
        where: { organizationId: workspace.organizationId, ...(id ? { id } : {}), ...(query ? { OR: [{ name: titleQuery }, { description: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, name: true, description: true, parentDepartmentId: true, leadUserId: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: row.description ?? "", path: `/orgchart?department=${row.id}`, metadata: { parentDepartmentId: row.parentDepartmentId, leadUserId: row.leadUserId, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "approval": {
      const rows = await db.approvalRequest.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ title: titleQuery }, { description: titleQuery }, { decisionNote: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, title: true, description: true, type: true, status: true, payload: true, decisionNote: true, risk: true, projectId: true, taskId: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.title, text: text(row.description, row.decisionNote, row.payload), path: `/security?approval=${row.id}`, metadata: { type: row.type, status: row.status, risk: row.risk, projectId: row.projectId, taskId: row.taskId, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "audit_log": {
      const rows = await db.auditLog.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ action: titleQuery }, { entityType: titleQuery }, { entityId: titleQuery }] } : {}) },
        orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, action: true, actorType: true, agentId: true, entityType: true, entityId: true, details: true, projectId: true, approvalRequestId: true, createdAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.action, text: text(row.details), path: `/activity?audit=${row.id}`, metadata: { actorType: row.actorType, agentId: row.agentId, entityType: row.entityType, entityId: row.entityId, projectId: row.projectId, approvalRequestId: row.approvalRequestId, createdAt: row.createdAt } }));
    }
    case "meeting": {
      const rows = await db.meeting.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ title: titleQuery }, { agenda: titleQuery }] } : {}) },
        orderBy: { startsAt: "desc" }, take: limit,
        select: { id: true, title: true, agenda: true, startsAt: true, endsAt: true, status: true, attendeeUserIds: true, attendeeAgentIds: true, projectId: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.title, text: row.agenda ?? "", path: `/dashboard?meeting=${row.id}`, metadata: { startsAt: row.startsAt, endsAt: row.endsAt, status: row.status, attendeeUserIds: row.attendeeUserIds, attendeeAgentIds: row.attendeeAgentIds, projectId: row.projectId } }));
    }
    case "conversation": {
      if (!projectIds.length) return [];
      const rows = await db.chatRoom.findMany({
        where: { projectId: { in: projectIds }, ...(id ? { id } : {}), ...(query ? { OR: [{ name: titleQuery }, { objective: titleQuery }, { messages: { some: { content: titleQuery } } }] } : {}) },
        orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, name: true, objective: true, mode: true, autonomyLevel: true, paused: true, projectId: true, agentIds: true, createdAt: true, messages: { orderBy: { createdAt: "asc" }, take: 100, select: { role: true, agentId: true, content: true, messageType: true, createdAt: true } } },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: text(row.objective, row.messages.map((message) => `[${message.createdAt.toISOString()}] ${message.role}${message.agentId ? ` (${message.agentId})` : ""}: ${message.content}`).join("\n")), path: `/chat?room=${row.id}`, metadata: { mode: row.mode, autonomyLevel: row.autonomyLevel, paused: row.paused, projectId: row.projectId, agentIds: row.agentIds, createdAt: row.createdAt, returnedMessages: row.messages.length } }));
    }
    case "decision": {
      if (!projectIds.length) return [];
      const rows = await db.decision.findMany({
        where: { projectId: { in: projectIds }, ...(id ? { id } : {}), ...(query ? { OR: [{ title: titleQuery }, { summary: titleQuery }, { rationale: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, title: true, summary: true, rationale: true, alternatives: true, sourceLinks: true, status: true, projectId: true, relatedTaskIds: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.title, text: text(row.summary, row.rationale, { alternatives: row.alternatives, sourceLinks: row.sourceLinks }), path: `/graph?decision=${row.id}`, metadata: { status: row.status, projectId: row.projectId, relatedTaskIds: row.relatedTaskIds, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "artifact": {
      if (!projectIds.length) return [];
      const rows = await db.artifact.findMany({
        where: { projectId: { in: projectIds }, ...(id ? { id } : {}), ...(query ? { OR: [{ title: titleQuery }, { description: titleQuery }, { content: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, title: true, description: true, content: true, storageUrl: true, mimeType: true, type: true, projectId: true, chatRoomId: true, taskId: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.title, text: text(row.description, row.content), path: `/files?artifact=${row.id}`, metadata: { type: row.type, storageUrl: row.storageUrl, mimeType: row.mimeType, projectId: row.projectId, chatRoomId: row.chatRoomId, taskId: row.taskId, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "knowledge": {
      const rows = await db.knowledgeObject.findMany({
        where: { AND: [{ OR: [{ workspaceId }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] }, ...(query ? [{ OR: [{ title: titleQuery }, { summary: titleQuery }] }] : [])], validTo: null, ...(id ? { id } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, title: true, summary: true, type: true, sourceType: true, sourceId: true, scope: true, projectId: true, metadata: true, version: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.title, text: text(row.summary, row.metadata), path: `/graph?node=${row.id}`, metadata: { type: row.type, sourceType: row.sourceType, sourceId: row.sourceId, scope: row.scope, projectId: row.projectId, version: row.version, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "skill": {
      const rows = await db.skill.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ name: titleQuery }, { description: titleQuery }, { domain: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, name: true, description: true, domain: true, steps: true, requiredTools: true, constraints: true, successMetrics: true, evidenceLinks: true, version: true, status: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: text(row.description, { steps: row.steps, constraints: row.constraints, successMetrics: row.successMetrics }), path: `/learning?skill=${row.id}`, metadata: { domain: row.domain, requiredTools: row.requiredTools, evidenceLinks: row.evidenceLinks, version: row.version, status: row.status, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "experience": {
      const rows = await db.experience.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ objective: titleQuery }, { underlyingGoal: titleQuery }, { evaluatorSummary: titleQuery }] } : {}) },
        orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, agentId: true, projectId: true, taskId: true, conversationId: true, objective: true, underlyingGoal: true, constraints: true, successCriteria: true, actionsTaken: true, toolsUsed: true, knowledgeUsed: true, outputArtifactIds: true, startedAt: true, completedAt: true, cost: true, latencyMs: true, outcomeStatus: true, userFeedback: true, evaluatorScore: true, evaluatorSummary: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.objective, text: text(row.underlyingGoal, row.evaluatorSummary, row.userFeedback, { constraints: row.constraints, successCriteria: row.successCriteria, actionsTaken: row.actionsTaken }), path: `/learning?experience=${row.id}`, metadata: { agentId: row.agentId, projectId: row.projectId, taskId: row.taskId, conversationId: row.conversationId, toolsUsed: row.toolsUsed, knowledgeUsed: row.knowledgeUsed, outputArtifactIds: row.outputArtifactIds, startedAt: row.startedAt, completedAt: row.completedAt, cost: row.cost, latencyMs: row.latencyMs, outcomeStatus: row.outcomeStatus, evaluatorScore: row.evaluatorScore } }));
    }
    case "evaluation": {
      const rows = await db.evaluation.findMany({
        where: { experience: { workspaceId }, ...(id ? { id } : {}), ...(query ? { critique: titleQuery } : {}) },
        orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, experienceId: true, evaluatorAgentId: true, successScore: true, qualityScore: true, efficiencyScore: true, safetyScore: true, confidence: true, critique: true, evidence: true, createdAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: `Evaluation ${row.id}`, text: text(row.critique, row.evidence), path: `/learning?evaluation=${row.id}`, metadata: { experienceId: row.experienceId, evaluatorAgentId: row.evaluatorAgentId, successScore: row.successScore, qualityScore: row.qualityScore, efficiencyScore: row.efficiencyScore, safetyScore: row.safetyScore, confidence: row.confidence, createdAt: row.createdAt } }));
    }
    case "learning_candidate": {
      const rows = await db.learningCandidate.findMany({
        where: {
          AND: [
            { OR: [{ experience: { workspaceId } }, { approvalRequest: { workspaceId } }, { knowledgeGap: { workspaceId } }] },
            ...(query ? [{ OR: [{ type: titleQuery }, { problem: titleQuery }, { rootCause: titleQuery }, { createdFrom: titleQuery }] }] : []),
          ],
          ...(id ? { id } : {}),
        },
        orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, type: true, proposedPayload: true, targetType: true, appliedTargetId: true, riskLevel: true, evidenceCount: true, confidence: true, status: true, problem: true, rootCause: true, testPlan: true, rolloutPlan: true, survivalStatus: true, fitnessScore: true, createdAt: true, resolvedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: `${row.type} candidate`, text: text(row.problem, row.rootCause, row.proposedPayload, { testPlan: row.testPlan, rolloutPlan: row.rolloutPlan }), path: `/learning?candidate=${row.id}`, metadata: { targetType: row.targetType, appliedTargetId: row.appliedTargetId, riskLevel: row.riskLevel, evidenceCount: row.evidenceCount, confidence: row.confidence, status: row.status, survivalStatus: row.survivalStatus, fitnessScore: row.fitnessScore, createdAt: row.createdAt, resolvedAt: row.resolvedAt } }));
    }
    case "reflection": {
      const rows = await db.reflection.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ summary: titleQuery }, { whatWorked: titleQuery }, { whatFailed: titleQuery }, { reusableLesson: titleQuery }, { suggestedImprovement: titleQuery }] } : {}) },
        orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, traceId: true, agentId: true, projectId: true, reflectionType: true, summary: true, whatWorked: true, whatFailed: true, unexpectedResults: true, incorrectAssumptions: true, missingInformation: true, reusableLesson: true, suggestedImprovement: true, shouldCreateSkill: true, shouldAskNextTime: true, confidence: true, status: true, createdAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.summary.slice(0, 120), text: text(row.summary, row.whatWorked, row.whatFailed, row.unexpectedResults, row.incorrectAssumptions, row.missingInformation, row.reusableLesson, row.suggestedImprovement), path: `/learning?reflection=${row.id}`, metadata: { traceId: row.traceId, agentId: row.agentId, projectId: row.projectId, reflectionType: row.reflectionType, shouldCreateSkill: row.shouldCreateSkill, shouldAskNextTime: row.shouldAskNextTime, confidence: row.confidence, status: row.status, createdAt: row.createdAt } }));
    }
    case "knowledge_gap": {
      const rows = await db.knowledgeGap.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ topic: titleQuery }, { description: titleQuery }, { recommendedAction: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, agentId: true, projectId: true, topic: true, description: true, source: true, frequency: true, businessImpact: true, failureImpact: true, confidence: true, priorityScore: true, status: true, recommendedAction: true, relatedTraceIds: true, createdAt: true, updatedAt: true, resolvedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.topic, text: text(row.description, row.recommendedAction), path: `/learning?gap=${row.id}`, metadata: { agentId: row.agentId, projectId: row.projectId, source: row.source, frequency: row.frequency, businessImpact: row.businessImpact, failureImpact: row.failureImpact, confidence: row.confidence, priorityScore: row.priorityScore, status: row.status, relatedTraceIds: row.relatedTraceIds, createdAt: row.createdAt, updatedAt: row.updatedAt, resolvedAt: row.resolvedAt } }));
    }
    case "learning_goal": {
      const rows = await db.learningGoal.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ title: titleQuery }, { objective: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, knowledgeGapId: true, agentId: true, title: true, objective: true, successCriteria: true, priority: true, status: true, approved: true, createdAt: true, updatedAt: true, completedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.title, text: text(row.objective, row.successCriteria), path: `/learning?goal=${row.id}`, metadata: { knowledgeGapId: row.knowledgeGapId, agentId: row.agentId, priority: row.priority, status: row.status, approved: row.approved, createdAt: row.createdAt, updatedAt: row.updatedAt, completedAt: row.completedAt } }));
    }
    case "principle": {
      const rows = await db.principle.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ statement: titleQuery }, { domain: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, statement: true, scope: true, domain: true, agentId: true, conditions: true, exceptions: true, confidence: true, evidenceCount: true, status: true, currentVersion: true, createdAt: true, updatedAt: true, lastValidatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.statement.slice(0, 120), text: text(row.statement, { conditions: row.conditions, exceptions: row.exceptions }), path: `/learning?principle=${row.id}`, metadata: { scope: row.scope, domain: row.domain, agentId: row.agentId, confidence: row.confidence, evidenceCount: row.evidenceCount, status: row.status, currentVersion: row.currentVersion, createdAt: row.createdAt, updatedAt: row.updatedAt, lastValidatedAt: row.lastValidatedAt } }));
    }
    case "eval_suite": {
      const rows = await db.evalSuite.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ name: titleQuery }, { description: titleQuery }, { category: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, name: true, description: true, category: true, status: true, createdAt: true, updatedAt: true, _count: { select: { cases: true, runs: true } } },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: row.description ?? "", path: `/learning?evalSuite=${row.id}`, metadata: { category: row.category, status: row.status, caseCount: row._count.cases, runCount: row._count.runs, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "guardian_decision": {
      const rows = await db.guardianDecision.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ action: titleQuery }, { actor: titleQuery }, { policyDecision: titleQuery }, { guardianDecision: titleQuery }] } : {}) },
        orderBy: { createdAt: "desc" }, take: limit,
        select: { id: true, action: true, actor: true, runtime: true, candidateId: true, tier: true, mode: true, risk: true, policyDecision: true, guardianDecision: true, confidence: true, reasonCodes: true, evidence: true, blocked: true, createdAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.action, text: text(row.policyDecision, row.guardianDecision, row.evidence), path: `/learning?guardian=${row.id}`, metadata: { actor: row.actor, runtime: row.runtime, candidateId: row.candidateId, tier: row.tier, mode: row.mode, risk: row.risk, confidence: row.confidence, reasonCodes: row.reasonCodes, blocked: row.blocked, createdAt: row.createdAt } }));
    }
    case "agent_workspace": {
      const rows = await db.agentWorkspace.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ name: titleQuery }, { description: titleQuery }, { slug: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, name: true, slug: true, description: true, status: true, runtimeType: true, agentId: true, projectId: true, locked: true, resourceLimits: true, policy: true, lastActiveAt: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.name, text: text(row.description, { resourceLimits: row.resourceLimits, policy: row.policy }), path: `/agent-workspaces?workspace=${row.id}`, metadata: { slug: row.slug, status: row.status, runtimeType: row.runtimeType, agentId: row.agentId, projectId: row.projectId, locked: row.locked, lastActiveAt: row.lastActiveAt, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "agent_runtime": {
      const rows = await db.agentRuntime.findMany({
        where: { workspaceId, ...(id ? { id } : {}), ...(query ? { OR: [{ agentId: titleQuery }, { kind: titleQuery }, { transport: titleQuery }] } : {}) },
        orderBy: { updatedAt: "desc" }, take: limit,
        select: { id: true, agentId: true, kind: true, transport: true, enabled: true, capabilities: true, healthConfig: true, createdAt: true, updatedAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: `${row.agentId} (${row.kind})`, text: text({ capabilities: row.capabilities, health: row.healthConfig }), path: `/agents?runtime=${row.id}`, metadata: { agentId: row.agentId, kind: row.kind, transport: row.transport, enabled: row.enabled, createdAt: row.createdAt, updatedAt: row.updatedAt } }));
    }
    case "workspace_event": {
      const rows = await db.workspaceEvent.findMany({
        where: { agentWorkspace: { workspaceId }, ...(id ? { id } : {}), ...(query ? { OR: [{ type: titleQuery }, { severity: titleQuery }, { source: titleQuery }, { message: titleQuery }] } : {}) },
        orderBy: { occurredAt: "desc" }, take: limit,
        select: { id: true, agentWorkspaceId: true, type: true, severity: true, actorUserId: true, actorAgentId: true, source: true, message: true, metadata: true, occurredAt: true },
      });
      return rows.map((row) => ({ kind, id: row.id, title: row.type, text: text(row.message, row.metadata), path: `/agent-workspaces?workspace=${row.agentWorkspaceId}&event=${row.id}`, metadata: { agentWorkspaceId: row.agentWorkspaceId, severity: row.severity, actorUserId: row.actorUserId, actorAgentId: row.actorAgentId, source: row.source, occurredAt: row.occurredAt } }));
    }
  }
}

export function prismaDataSource(): McpDataSource {
  return {
    async getWorkspaceOverview({ workspaceId, userId }) {
      if (!workspaceId || !(await canUseMcpWorkspace(userId, workspaceId))) return null;
      const workspace = await db.workspace.findUnique({ where: { id: workspaceId }, select: { id: true, name: true, slug: true, description: true, kind: true } });
      if (!workspace) return null;
      const projectIds = await projectIdsForWorkspace(workspaceId);
      const [projects, teams, agents, tasks, documents, notes, workflows, approvals, meetings, conversations, knowledge, agentWorkspaces, agentRuntimes] = await Promise.all([
        db.project.count({ where: { workspaceId } }),
        db.team.count({ where: { workspaceId } }),
        db.agent.count({ where: { workspaceId } }),
        db.task.count({ where: { workspaceId } }),
        db.document.count({ where: { OR: [{ workspaceId }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])] } }),
        projectIds.length ? db.obsidianNote.count({ where: { projectId: { in: projectIds } } }) : 0,
        projectIds.length ? db.workflow.count({ where: { projectId: { in: projectIds } } }) : 0,
        db.approvalRequest.count({ where: { workspaceId } }),
        db.meeting.count({ where: { workspaceId } }),
        projectIds.length ? db.chatRoom.count({ where: { projectId: { in: projectIds } } }) : 0,
        db.knowledgeObject.count({ where: { OR: [{ workspaceId }, ...(projectIds.length ? [{ projectId: { in: projectIds } }] : [])], validTo: null } }),
        db.agentWorkspace.count({ where: { workspaceId } }),
        db.agentRuntime.count({ where: { workspaceId } }),
      ]);
      return { workspace, counts: { projects, teams, agents, tasks, documents, notes, workflows, approvals, meetings, conversations, knowledge, agentWorkspaces, agentRuntimes } };
    },

    async listCatalogRecords({ workspaceId, userId, kind, query, limit }) {
      if (!workspaceId || !(await canUseMcpWorkspace(userId, workspaceId))) return [];
      if (kind) return catalogForKind(kind, { workspaceId, userId, query, limit });
      const projectIds = await projectIdsForWorkspace(workspaceId);
      const perKind = Math.min(limit, 5);
      const catalog = await Promise.all([
        ...CATALOG_KINDS.map((entry) => catalogForKind(entry, { workspaceId, userId, query, limit: perKind, projectIds })),
        this.searchMemories({ workspaceId, userId, query: query ?? "", limit: perKind }).then((rows) => rows.map((row): CatalogRecord => ({ kind: "memory", id: row.id, title: row.content.slice(0, 100), text: row.content, path: `/memory?id=${row.id}`, metadata: { type: row.type, tags: row.tags, importanceScore: row.importanceScore, createdAt: row.createdAt } }))),
        this.listTasks({ workspaceId, limit: Math.max(perKind, 50) }).then((rows) => rows.filter((row) => !query || `${row.title} ${row.description ?? ""}`.toLowerCase().includes(query.toLowerCase())).slice(0, perKind).map((row): CatalogRecord => ({ kind: "task", id: row.id, title: row.title, text: row.description ?? row.title, path: `/kanban?task=${row.id}`, metadata: { status: row.status, priority: row.priority, agentId: row.agentId, createdAt: row.createdAt } }))),
      ]);
      // Interleave record classes so a common query cannot fill the result
      // window with the first kind and starve later learning/runtime domains.
      const records: CatalogRecord[] = [];
      for (let index = 0; records.length < limit; index += 1) {
        let found = false;
        for (const group of catalog) {
          if (group[index]) {
            records.push(group[index]);
            found = true;
            if (records.length === limit) break;
          }
        }
        if (!found) break;
      }
      return records;
    },

    async getCatalogRecord({ workspaceId, userId, kind, id }) {
      if (!workspaceId || !(await canUseMcpWorkspace(userId, workspaceId))) return null;
      if (kind === "memory") {
        const row = await this.getMemory({ workspaceId, userId, id });
        return row ? { kind, id: row.id, title: row.content.slice(0, 100), text: row.content, path: `/memory?id=${row.id}`, metadata: { type: row.type, tags: row.tags, importanceScore: row.importanceScore, createdAt: row.createdAt } } : null;
      }
      if (kind === "task") {
        const row = await this.getTask({ workspaceId, id });
        return row ? { kind, id: row.id, title: row.title, text: row.description ?? row.title, path: `/kanban?task=${row.id}`, metadata: { status: row.status, priority: row.priority, agentId: row.agentId, createdAt: row.createdAt } } : null;
      }
      return (await catalogForKind(kind, { workspaceId, userId, limit: 1, id }))[0] ?? null;
    },

    async listAgents({ workspaceId, limit }) {
      if (!workspaceId) return [];
      return db.agent.findMany({ where: { workspaceId }, orderBy: { createdAt: "desc" }, take: limit, select: { id: true, name: true, role: true, description: true, status: true, model: true } });
    },

    async searchMemories({ workspaceId, query, limit }) {
      if (!workspaceId) return [];
      const projectIds = await projectIdsForWorkspace(workspaceId);
      if (!projectIds.length) return [];
      return db.memory.findMany({
        where: { projectId: { in: projectIds }, archived: false, state: { notIn: ["forgotten", "quarantined"] }, ...(query ? { OR: [{ content: contains(query) }, { tags: { has: query } }] } : {}) },
        orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }], take: limit,
        select: { id: true, type: true, content: true, tags: true, importanceScore: true, createdAt: true },
      });
    },

    async listTasks({ workspaceId, status, limit }) {
      if (!workspaceId) return [];
      return db.task.findMany({ where: { workspaceId, ...(status ? { status } : {}) }, orderBy: [{ position: "asc" }, { createdAt: "desc" }], take: limit, select: { id: true, title: true, description: true, status: true, priority: true, agentId: true, createdAt: true } });
    },

    async createTask({ workspaceId, title, description, priority }) {
      if (!workspaceId) throw new Error("The connector is not bound to a workspace.");
      return db.task.create({ data: { workspaceId, title, description, priority: priority ?? "medium", status: "backlog" }, select: { id: true, title: true, description: true, status: true, priority: true, agentId: true, createdAt: true } });
    },

    async getTask({ workspaceId, id }) {
      if (!workspaceId) return null;
      return db.task.findFirst({ where: { id, workspaceId }, select: { id: true, title: true, description: true, status: true, priority: true, agentId: true, createdAt: true } });
    },

    async getMemory({ workspaceId, id }) {
      if (!workspaceId) return null;
      const projectIds = await projectIdsForWorkspace(workspaceId);
      if (!projectIds.length) return null;
      return db.memory.findFirst({ where: { id, projectId: { in: projectIds }, archived: false, state: { notIn: ["forgotten", "quarantined"] } }, select: { id: true, type: true, content: true, tags: true, importanceScore: true, createdAt: true } });
    },
  };
}
