import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { emitAdaptiveEvent } from "./event-service";
import { requireAdaptiveScope } from "./scope";
import { scanUntrustedContent } from "./security";

const json = (value: unknown) => value as Prisma.InputJsonValue;
const WRITE_TOOL = /(?:create|update|delete|send|deploy|execute|write|run_workflow|start_agent)/i;

export interface SkillCandidateInput {
  organizationId?: string; workspaceId?: string; projectId?: string; agentId?: string;
  name: string; description: string; purpose: string; triggerConditions: string[];
  prerequisites: string[]; inputs: unknown[]; outputs: unknown[]; steps: unknown[];
  toolPermissions: string[]; approvalRequirements: string[]; sourceRunIds: string[];
  sourceEvidenceIds: string[]; expectedSuccessCriteria: string[]; verificationSteps: string[];
  rollbackSteps: string[]; baselineScore?: number; candidateScore?: number;
  risk: number; confidence: number; proposedBy: string;
}

export function scanSkillCandidate(input: Pick<SkillCandidateInput, "description" | "purpose" | "steps" | "toolPermissions" | "sourceRunIds" | "rollbackSteps">) {
  const findings = scanUntrustedContent(`${input.description}\n${input.purpose}\n${JSON.stringify(input.steps)}`);
  if (input.sourceRunIds.length < 2) findings.push({ code: "insufficient_independent_runs", excerpt: "At least two source runs are required." });
  if (input.toolPermissions.some((tool) => WRITE_TOOL.test(tool)) && input.rollbackSteps.length === 0) {
    findings.push({ code: "write_tool_without_rollback", excerpt: "Write-capable skills require rollback steps." });
  }
  return findings;
}

export async function createSkillCandidate(input: SkillCandidateInput, actorUserId: string) {
  await requireAdaptiveScope({ ...input, actorUserId, permission: "knowledge.write" });
  const findings = scanSkillCandidate(input);
  const candidate = await db.skillCandidate.create({ data: {
    organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
    agentId: input.agentId, name: input.name, description: input.description, purpose: input.purpose,
    triggerConditions: input.triggerConditions, prerequisites: input.prerequisites,
    inputs: json(input.inputs), outputs: json(input.outputs), steps: json(input.steps),
    toolPermissions: input.toolPermissions, approvalRequirements: input.approvalRequirements,
    sourceRunIds: input.sourceRunIds, sourceEvidenceIds: input.sourceEvidenceIds,
    expectedSuccessCriteria: input.expectedSuccessCriteria, verificationSteps: input.verificationSteps,
    rollbackSteps: input.rollbackSteps, baselineScore: input.baselineScore, candidateScore: input.candidateScore,
    risk: Math.max(0, Math.min(1, input.risk)), confidence: Math.max(0, Math.min(1, input.confidence)),
    securityFindings: json(findings), status: findings.length ? "draft" : "testing", proposedBy: input.proposedBy,
  }});
  await emitAdaptiveEvent({ type: "skill.candidate_created", userId: actorUserId,
    agentId: input.agentId, workspaceId: input.workspaceId, projectId: input.projectId,
    payload: { candidateId: candidate.id, findings: findings.map((finding) => finding.code) } });
  return candidate;
}

export async function recordSkillReplay(input: {
  candidateId: string; fixtureName: string; status: "passed" | "failed";
  metrics: Record<string, number>; failures?: unknown[]; durationMs?: number; cost?: number;
  dryRun?: boolean; mockedWrites?: boolean; actorUserId: string;
}) {
  const candidate = await db.skillCandidate.findUniqueOrThrow({ where: { id: input.candidateId } });
  await requireAdaptiveScope({ actorUserId: input.actorUserId, workspaceId: candidate.workspaceId,
    projectId: candidate.projectId, permission: "knowledge.write" });
  await emitAdaptiveEvent({ type: "skill.test_started", userId: input.actorUserId,
    workspaceId: candidate.workspaceId ?? undefined, projectId: candidate.projectId ?? undefined,
    payload: { candidateId: candidate.id, fixtureName: input.fixtureName } });
  const result = await db.skillReplayResult.create({ data: {
    candidateId: candidate.id, fixtureName: input.fixtureName, dryRun: input.dryRun ?? true,
    mockedWrites: input.mockedWrites ?? true, status: input.status, metrics: json(input.metrics),
    failures: json(input.failures ?? []), durationMs: input.durationMs, cost: input.cost,
  }});
  const all = await db.skillReplayResult.findMany({ where: { candidateId: candidate.id } });
  const passRate = all.filter((row) => row.status === "passed").length / all.length;
  await db.skillCandidate.update({ where: { id: candidate.id }, data: {
    candidateScore: passRate, status: all.length >= 2 && passRate === 1 ? "pending_review" : input.status === "failed" ? "draft" : "testing",
  }});
  await emitAdaptiveEvent({ type: "skill.test_completed", userId: input.actorUserId,
    workspaceId: candidate.workspaceId ?? undefined, projectId: candidate.projectId ?? undefined,
    durationMs: input.durationMs, cost: input.cost, result: input.status,
    payload: { candidateId: candidate.id, replayId: result.id, passRate } });
  return result;
}

export async function reviewSkillCandidate(candidateId: string, decision: "approve" | "reject", reviewerId: string, note?: string) {
  const candidate = await db.skillCandidate.findUniqueOrThrow({ where: { id: candidateId }, include: { replayResults: true } });
  await requireAdaptiveScope({ actorUserId: reviewerId, workspaceId: candidate.workspaceId,
    projectId: candidate.projectId, permission: "knowledge.approve" });
  if (candidate.agentId && reviewerId === candidate.agentId) throw new Error("Agents cannot approve their own skill candidates.");
  if (decision === "reject") {
    const rejected = await db.skillCandidate.update({ where: { id: candidateId }, data: { status: "rejected", reviewedBy: reviewerId, reviewNote: note, resolvedAt: new Date() } });
    await writeAuditLog({ workspaceId: candidate.workspaceId, projectId: candidate.projectId,
      userId: reviewerId, action: "skill.rejected", entityType: "skillCandidate", entityId: candidateId, details: { note: note ?? null } });
    return rejected;
  }
  const findings = candidate.securityFindings as Array<{ code: string }>;
  if (findings.length) throw new Error(`Security scan has unresolved findings: ${findings.map((finding) => finding.code).join(", ")}`);
  if (candidate.replayResults.length < 2 || candidate.replayResults.some((result) => result.status !== "passed")) {
    throw new Error("At least two passing replay fixtures are required.");
  }
  if (candidate.baselineScore != null && (candidate.candidateScore ?? 0) <= candidate.baselineScore) {
    throw new Error("Candidate does not outperform its recorded baseline.");
  }
  const promoted = await db.$transaction(async (tx) => {
    const skill = await tx.skill.create({ data: {
      name: candidate.name, description: candidate.description, domain: "adaptive",
      steps: json(candidate.steps), requiredTools: candidate.toolPermissions,
      constraints: json({ prerequisites: candidate.prerequisites, approvalRequirements: candidate.approvalRequirements }),
      successMetrics: json({ criteria: candidate.expectedSuccessCriteria, score: candidate.candidateScore }),
      evidenceLinks: candidate.sourceEvidenceIds, owner: reviewerId, status: "active",
    }});
    await tx.skillVersion.create({ data: {
      skillId: skill.id, version: 1, specification: json({ purpose: candidate.purpose,
        triggers: candidate.triggerConditions, inputs: candidate.inputs, outputs: candidate.outputs,
        steps: candidate.steps, verificationSteps: candidate.verificationSteps, rollbackSteps: candidate.rollbackSteps,
        toolPermissions: candidate.toolPermissions, approvalRequirements: candidate.approvalRequirements }),
      evidenceIds: candidate.sourceEvidenceIds, baselineScore: candidate.baselineScore,
      evaluationScore: candidate.candidateScore, status: "active", activatedAt: new Date(), createdBy: reviewerId,
    }});
    return tx.skillCandidate.update({ where: { id: candidate.id }, data: {
      status: "active", reviewedBy: reviewerId, reviewNote: note, promotedSkillId: skill.id, resolvedAt: new Date(),
    }});
  });
  await emitAdaptiveEvent({ type: "skill.activated", userId: reviewerId,
    workspaceId: candidate.workspaceId ?? undefined, projectId: candidate.projectId ?? undefined,
    payload: { candidateId, skillId: promoted.promotedSkillId, version: 1 } });
  return promoted;
}

export async function rollbackSkill(skillId: string, actorUserId: string, reason: string) {
  const active = await db.skillVersion.findFirstOrThrow({ where: { skillId, status: "active" }, orderBy: { version: "desc" } });
  const prior = await db.skillVersion.findFirst({ where: { skillId, version: { lt: active.version } }, orderBy: { version: "desc" } });
  await db.$transaction(async (tx) => {
    await tx.skillVersion.update({ where: { id: active.id }, data: { status: "rolled_back", retiredAt: new Date(), rollbackToId: prior?.id } });
    if (prior) await tx.skillVersion.update({ where: { id: prior.id }, data: { status: "active", activatedAt: new Date() } });
    await tx.skill.update({ where: { id: skillId }, data: { status: prior ? "active" : "rolled_back", version: prior?.version ?? active.version } });
  });
  await emitAdaptiveEvent({ type: "skill.rolled_back", userId: actorUserId, payload: { skillId, fromVersion: active.version, toVersion: prior?.version ?? null, reason } });
}
