// Step-specific memory retrieval.
//
// Stops dumping every potentially relevant memory into the start of every
// prompt. Each agent lifecycle stage gets a narrow, real DB query for the
// memory class that actually matters at that stage — reusing the canonical
// `Memory`/`Principle`/`Policy`/`ApprovalRequest` tables, never a parallel
// retrieval index. Every hook excludes quarantined/forgotten memories via
// the same excludeFromRetrieval() filter src/lib/knowledge/retrieval.ts
// already uses, and records a usage hit (lastUsefulAt/confirmationCount) on
// what it actually returns — retrieval that never gets used should decay,
// per governed forgetting.

import { db } from "@/lib/db";
import { excludeFromRetrieval, recordMemoryUsed } from "./memory-governance";

export type RetrievalStage =
  | "before_plan"
  | "before_tool"
  | "before_external_action"
  | "before_code_change"
  | "before_deployment"
  | "before_response"
  | "after_failure"
  | "after_success";

export interface RetrievalHookContext {
  agentId?: string;
  userId?: string;
  workspaceId?: string;
  projectId?: string;
  maxItems?: number;
}

export interface StageRetrievalResult {
  stage: RetrievalStage;
  memories: Array<{ id: string; content: string; tags: string[]; type: string }>;
  principles: Array<{ id: string; statement: string; conditions: unknown }>;
  policies?: Array<{ id: string; name: string; rules: unknown }>;
  approvals?: Array<{ id: string; title: string; status: string }>;
}

function memoryScopeWhere(ctx: RetrievalHookContext) {
  return {
    archived: false,
    ...excludeFromRetrieval(),
    ...(ctx.projectId ? { projectId: ctx.projectId } : {}),
  };
}

async function recordHits(memories: Array<{ id: string }>) {
  await Promise.all(memories.map((m) => recordMemoryUsed(m.id)));
}

/** Planning stage — project goals, constraints, relevant prior decisions. */
export async function retrieveForPlanning(ctx: RetrievalHookContext): Promise<StageRetrievalResult> {
  const take = Math.min(ctx.maxItems ?? 15, 50);
  const [memories, principles] = await Promise.all([
    db.memory.findMany({
      where: { ...memoryScopeWhere(ctx), tags: { hasSome: ["goal", "constraint", "decision"] } },
      orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }],
      take,
    }),
    db.principle.findMany({
      where: { status: "active", ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}) },
      orderBy: { confidence: "desc" },
      take: 10,
    }),
  ]);
  await recordHits(memories);
  return {
    stage: "before_plan",
    memories: memories.map(shapeMemory),
    principles: principles.map(shapePrinciple),
  };
}

/** Execution stage — procedures, tool policy, environment constraints. */
export async function retrieveForToolUse(ctx: RetrievalHookContext): Promise<StageRetrievalResult> {
  const take = Math.min(ctx.maxItems ?? 15, 50);
  const [memories, principles, policies] = await Promise.all([
    db.memory.findMany({
      where: { ...memoryScopeWhere(ctx), tags: { hasSome: ["tool", "procedure", "environment"] } },
      orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }],
      take,
    }),
    db.principle.findMany({
      where: { status: "active", domain: "tool_use", ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}) },
      take: 10,
    }),
    db.policy.findMany({ where: { status: "active", domain: "tool_use" }, take: 10 }),
  ]);
  await recordHits(memories);
  return {
    stage: "before_tool",
    memories: memories.map(shapeMemory),
    principles: principles.map(shapePrinciple),
    policies: policies.map(shapePolicy),
  };
}

/** Risk stage (external action / deployment) — approvals, security policy, past failures. */
export async function retrieveForRiskStage(
  stage: "before_external_action" | "before_deployment",
  ctx: RetrievalHookContext,
): Promise<StageRetrievalResult> {
  const take = Math.min(ctx.maxItems ?? 15, 50);
  const [memories, principles, policies, approvals] = await Promise.all([
    db.memory.findMany({
      where: { ...memoryScopeWhere(ctx), tags: { hasSome: ["failure", "risk", "security", "deployment"] } },
      orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }],
      take,
    }),
    db.principle.findMany({
      where: {
        status: "active",
        domain: stage === "before_deployment" ? "deployment" : "external_action",
        ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}),
      },
      take: 10,
    }),
    db.policy.findMany({ where: { status: "active", riskLevel: { in: ["medium", "high"] } }, take: 10 }),
    ctx.workspaceId
      ? db.approvalRequest.findMany({
          where: { workspaceId: ctx.workspaceId, status: "pending" },
          take: 10,
        })
      : Promise.resolve([]),
  ]);
  await recordHits(memories);
  return {
    stage,
    memories: memories.map(shapeMemory),
    principles: principles.map(shapePrinciple),
    policies: policies.map(shapePolicy),
    approvals: approvals.map((a) => ({ id: a.id, title: a.title, status: a.status })),
  };
}

/** Code-change stage — coding procedures/conventions and past code-change failures. */
export async function retrieveForCodeChange(ctx: RetrievalHookContext): Promise<StageRetrievalResult> {
  const take = Math.min(ctx.maxItems ?? 15, 50);
  const [memories, principles] = await Promise.all([
    db.memory.findMany({
      where: { ...memoryScopeWhere(ctx), tags: { hasSome: ["code", "convention", "test_failure"] } },
      orderBy: [{ importanceScore: "desc" }, { createdAt: "desc" }],
      take,
    }),
    db.principle.findMany({
      where: { status: "active", domain: "code_change", ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}) },
      take: 10,
    }),
  ]);
  await recordHits(memories);
  return { stage: "before_code_change", memories: memories.map(shapeMemory), principles: principles.map(shapePrinciple) };
}

/** Response stage — communication/formatting preferences only. */
export async function retrieveForResponse(ctx: RetrievalHookContext): Promise<StageRetrievalResult> {
  const take = Math.min(ctx.maxItems ?? 10, 30);
  const memories = await db.memory.findMany({
    where: { ...memoryScopeWhere(ctx), type: "preference", tags: { hasSome: ["communication", "formatting"] } },
    orderBy: [{ confirmationCount: "desc" }, { importanceScore: "desc" }],
    take,
  });
  await recordHits(memories);
  return { stage: "before_response", memories: memories.map(shapeMemory), principles: [] };
}

/** Post-hoc stages — surfaces the relevant lesson/principle after the fact, for the *next* similar task rather than mid-task. */
export async function retrieveAfterOutcome(
  stage: "after_failure" | "after_success",
  ctx: RetrievalHookContext,
): Promise<StageRetrievalResult> {
  const principles = await db.principle.findMany({
    where: { status: "active", ...(ctx.workspaceId ? { workspaceId: ctx.workspaceId } : {}) },
    orderBy: { evidenceCount: "desc" },
    take: 5,
  });
  return { stage, memories: [], principles: principles.map(shapePrinciple) };
}

export async function retrieveForStage(stage: RetrievalStage, ctx: RetrievalHookContext): Promise<StageRetrievalResult> {
  switch (stage) {
    case "before_plan":
      return retrieveForPlanning(ctx);
    case "before_tool":
      return retrieveForToolUse(ctx);
    case "before_external_action":
    case "before_deployment":
      return retrieveForRiskStage(stage, ctx);
    case "before_code_change":
      return retrieveForCodeChange(ctx);
    case "before_response":
      return retrieveForResponse(ctx);
    case "after_failure":
    case "after_success":
      return retrieveAfterOutcome(stage, ctx);
  }
}

function shapeMemory(m: { id: string; content: string; tags: string[]; type: string }) {
  return { id: m.id, content: m.content, tags: m.tags, type: m.type };
}
function shapePrinciple(p: { id: string; statement: string; conditions: unknown }) {
  return { id: p.id, statement: p.statement, conditions: p.conditions };
}
function shapePolicy(p: { id: string; name: string; rules: unknown }) {
  return { id: p.id, name: p.name, rules: p.rules };
}
