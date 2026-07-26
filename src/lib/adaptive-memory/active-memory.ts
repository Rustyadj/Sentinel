import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import type { ActiveMemoryCard } from "./types";

const DEFAULT_MAX_TOKENS = 1200;
const MIN_MAX_TOKENS = 600;
const ABSOLUTE_MAX_TOKENS = 1600;

export function estimateTokens(text: string) { return Math.ceil(text.length / 4); }

function renderCard(card: ActiveMemoryCard) {
  const lines = [
    `User: ${card.actingUser.id}`,
    `Agent: ${card.agent.id} (${card.agent.role})`,
    card.organization ? `Organization: ${card.organization.name} (${card.organization.id})` : "",
    card.workspace ? `Workspace: ${card.workspace.name} (${card.workspace.id})` : "",
    card.project ? `Project: ${card.project.name} (${card.project.id})` : "",
    `Objective: ${card.objective}`,
    card.actingUser.preferences.length ? `Preferences: ${card.actingUser.preferences.join("; ")}` : "",
    card.activeDecisions.length ? `Active decisions: ${card.activeDecisions.map((d) => `${d.title}: ${d.summary}`).join(" | ")}` : "",
    card.constraints.length ? `Constraints: ${card.constraints.join("; ")}` : "",
    card.criticalPolicies.length ? `Critical policies: ${card.criticalPolicies.map((p) => `${p.name}: ${p.description}`).join(" | ")}` : "",
    card.agent.toolRestrictions.length ? `Tool restrictions: ${card.agent.toolRestrictions.join(", ")}` : "",
    card.approvalRequirements.length ? `Approval required: ${card.approvalRequirements.join("; ")}` : "",
  ];
  return lines.filter(Boolean).join("\n");
}

export function boundActiveMemoryCard(card: ActiveMemoryCard, maxTokens: number) {
  const copy: ActiveMemoryCard = JSON.parse(JSON.stringify(card));
  let text = renderCard(copy);
  const shrink = () => {
    if (copy.activeDecisions.length > 1) copy.activeDecisions.pop();
    else if (copy.criticalPolicies.length > 1) copy.criticalPolicies.pop();
    else if (copy.actingUser.preferences.length > 1) copy.actingUser.preferences.pop();
    else if (copy.constraints.length > 1) copy.constraints.pop();
    else return false;
    return true;
  };
  while (estimateTokens(text) > maxTokens && shrink()) text = renderCard(copy);
  if (estimateTokens(text) > maxTokens) text = text.slice(0, maxTokens * 4 - 16) + "\n[TRUNCATED]";
  return { card: copy, text, tokens: estimateTokens(text) };
}

export async function createActiveMemorySnapshot(input: {
  runId: string; userId: string; agentId: string; objective: string;
  organizationId?: string; workspaceId?: string; projectId?: string; maxTokens?: number;
}) {
  const maxTokens = Math.min(ABSOLUTE_MAX_TOKENS, Math.max(MIN_MAX_TOKENS, input.maxTokens ?? Number(process.env.ACTIVE_MEMORY_MAX_TOKENS ?? DEFAULT_MAX_TOKENS)));
  const [run, user, agent, organization, workspace, project, decisions, policies, preferences] = await Promise.all([
    db.experience.findUniqueOrThrow({ where: { id: input.runId } }),
    db.user.findUniqueOrThrow({ where: { id: input.userId }, select: { id: true } }),
    db.agent.findUniqueOrThrow({ where: { id: input.agentId }, select: { id: true, role: true, toolPermissions: true, workspaceId: true } }),
    input.organizationId ? db.organization.findUnique({ where: { id: input.organizationId }, select: { id: true, name: true } }) : null,
    input.workspaceId ? db.workspace.findUnique({ where: { id: input.workspaceId }, select: { id: true, name: true } }) : null,
    input.projectId ? db.project.findUnique({ where: { id: input.projectId }, select: { id: true, name: true } }) : null,
    db.decision.findMany({ where: { ...(input.projectId ? { projectId: input.projectId } : { projectId: null, userId: input.userId }), status: "approved", validTo: null }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, title: true, summary: true } }),
    db.policy.findMany({ where: { status: "active", owner: input.userId, OR: [{ domain: "security" }, { domain: "approval" }, { riskLevel: "high" }] }, orderBy: { updatedAt: "desc" }, take: 8, select: { id: true, name: true, description: true, rules: true, riskLevel: true } }),
    db.memoryCandidate.findMany({ where: { userId: input.userId, candidateType: "preference", status: { in: ["approved", "auto_approved"] } }, orderBy: { resolvedAt: "desc" }, take: 8, select: { content: true } }),
  ]);
  if (run.agentId !== input.agentId || run.objective !== input.objective) throw new Error("Active-memory scope does not match the run.");
  if (input.workspaceId && agent.workspaceId !== input.workspaceId) throw new Error("Agent is outside the active-memory workspace.");
  const card: ActiveMemoryCard = {
    actingUser: { id: user.id, preferences: preferences.map((preference) => preference.content) },
    agent: { id: agent.id, role: agent.role, toolRestrictions: agent.toolPermissions },
    organization: organization ?? undefined, workspace: workspace ?? undefined, project: project ?? undefined,
    objective: input.objective, activeDecisions: decisions, constraints: [],
    criticalPolicies: policies.map((policy) => ({ id: policy.id, name: policy.name, description: policy.description })),
    approvalRequirements: policies.map((policy) => `${policy.name} (${policy.riskLevel})`),
  };
  const bounded = boundActiveMemoryCard(card, maxTokens);
  const contentHash = createHash("sha256").update(bounded.text).digest("hex");
  return db.activeMemorySnapshot.create({ data: {
    runId: input.runId, userId: input.userId, agentId: input.agentId,
    organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
    objective: input.objective, card: bounded.card as unknown as Prisma.InputJsonValue,
    renderedText: bounded.text, estimatedTokens: bounded.tokens, maxTokens, contentHash,
  }});
}

export async function getActiveMemorySnapshot(runId: string) {
  return db.activeMemorySnapshot.findUnique({ where: { runId } });
}
