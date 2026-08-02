import { createHash } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { evaluatePromotion } from "./benchmarks";
import { getSandbox } from "./sandbox";
import {
  evaluateShadowPromotion,
  listShadowRuns,
  runShadowSample,
} from "./shadow";
import { createSkillVersion } from "./skill-versions";
import {
  classifySkillPermissionRisk,
} from "@/lib/neural-engine/policy-service";
import { emitNeuralEvent } from "@/lib/neural-engine/event-service";
import { proposeCandidate } from "@/lib/neural-engine/learning-service";

const DEFAULT_LOOKBACK_DAYS = 30;
const MIN_PATTERN_OCCURRENCES = 2;
const MAX_SCAN_ROWS = 1_000;
const OPPORTUNITY_PREFIX = "skill-opportunity:";

export interface DetectSkillOpportunityParams {
  agentId?: string;
  workspaceId?: string;
  projectId?: string;
  since?: Date;
  limit?: number;
}

export interface SkillOpportunity {
  opportunityKey: string;
  topic: string;
  summary: string;
  agentId: string;
  workspaceId: string | null;
  projectId: string | null;
  reflectionIds: string[];
  traceIds: string[];
  occurrenceCount: number;
  confidence: number;
  existingSkillId: string | null;
}

interface OpportunityGroup {
  topic: string;
  summary: string;
  agentId: string;
  workspaceId: string | null;
  projectId: string | null;
  reflections: Array<{
    id: string;
    traceId: string | null;
    confidence: number | null;
  }>;
}

export interface ProposeSkillFromPatternInput extends SkillOpportunity {
  name: string;
  description: string;
  domain: string;
  requestedPermissions: string[];
  permissions: string[];
  inputSchema: Record<string, unknown>;
  outputSchema: Record<string, unknown>;
  implementationCommand: string[];
  testCommand: string[];
  dependencies?: string[];
}

export interface RunSkillGenerationPipelineInput {
  candidateId: string;
  benchmarkId: string;
  sourceExperienceIds: string[];
}

export function normalizeSkillTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Find repeated, explicit Reflection signals and collapse them by normalized
 * topic and tenant/agent scope. The same advisory identity is used by the
 * proposal write, so a concurrent detector waits and sees the proposal that
 * won instead of presenting a duplicate opportunity.
 */
export async function detectSkillOpportunity(
  params: DetectSkillOpportunityParams = {},
): Promise<SkillOpportunity[]> {
  const since = params.since ?? new Date(
    Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1_000,
  );
  const reflections = await db.reflection.findMany({
    where: {
      shouldCreateSkill: true,
      status: { not: "dismissed" },
      createdAt: { gte: since },
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(params.limit ?? 500, 1), MAX_SCAN_ROWS),
  });

  const groups = new Map<string, OpportunityGroup>();
  for (const reflection of reflections) {
    const summary = reflectionSkillTopic(reflection);
    const topic = normalizeSkillTopic(summary);
    if (!topic) continue;
    const groupKey = JSON.stringify([
      reflection.agentId,
      reflection.workspaceId,
      reflection.projectId,
      topic,
    ]);
    const existing = groups.get(groupKey);
    if (existing) {
      existing.reflections.push({
        id: reflection.id,
        traceId: reflection.traceId,
        confidence: reflection.confidence,
      });
    } else {
      groups.set(groupKey, {
        topic,
        summary,
        agentId: reflection.agentId,
        workspaceId: reflection.workspaceId,
        projectId: reflection.projectId,
        reflections: [{
          id: reflection.id,
          traceId: reflection.traceId,
          confidence: reflection.confidence,
        }],
      });
    }
  }

  const opportunities: SkillOpportunity[] = [];
  for (const group of groups.values()) {
    if (group.reflections.length < MIN_PATTERN_OCCURRENCES) continue;
    const opportunityKey = skillOpportunityKey(group);
    const existingSkillId = await findExistingSkillWithLock(opportunityKey);
    const observedConfidence = group.reflections
      .flatMap((reflection) => reflection.confidence == null ? [] : [reflection.confidence]);
    opportunities.push({
      opportunityKey,
      topic: group.topic,
      summary: group.summary,
      agentId: group.agentId,
      workspaceId: group.workspaceId,
      projectId: group.projectId,
      reflectionIds: group.reflections.map((reflection) => reflection.id),
      traceIds: group.reflections.flatMap((reflection) =>
        reflection.traceId ? [reflection.traceId] : [],
      ),
      occurrenceCount: group.reflections.length,
      confidence: observedConfidence.length > 0
        ? observedConfidence.reduce((sum, value) => sum + value, 0) / observedConfidence.length
        : 0.5,
      existingSkillId,
    });
  }
  return opportunities.sort((left, right) => right.occurrenceCount - left.occurrenceCount);
}

/**
 * Persist one deduplicated proposal. Schemas and permission sets are required
 * inputs: this service never guesses, expands, or grants a permission that
 * was not explicitly requested and analyzed.
 */
export async function proposeSkillFromPattern(input: ProposeSkillFromPatternInput) {
  validateProposalInput(input);
  const normalizedTopic = normalizeSkillTopic(input.topic);
  const expectedOpportunityKey = skillOpportunityKey({
    topic: normalizedTopic,
    agentId: input.agentId,
    workspaceId: input.workspaceId,
    projectId: input.projectId,
  });
  if (input.opportunityKey !== expectedOpportunityKey) {
    throw new Error("opportunityKey does not match the normalized pattern scope.");
  }
  const permissionRisk = classifySkillPermissionRisk(
    input.permissions,
    input.requestedPermissions,
  );
  const sentinel = `${OPPORTUNITY_PREFIX}${input.opportunityKey}`;

  const result = await db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill-opportunity:${input.opportunityKey}`})) IS NULL AS locked`;
    const evidence = await tx.reflection.findMany({
      where: {
        id: { in: input.reflectionIds },
        shouldCreateSkill: true,
        status: { not: "dismissed" },
        agentId: input.agentId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
      },
    });
    if (
      evidence.length < MIN_PATTERN_OCCURRENCES ||
      evidence.length !== new Set(input.reflectionIds).size ||
      evidence.some((reflection) =>
        normalizeSkillTopic(reflectionSkillTopic(reflection)) !== normalizedTopic,
      )
    ) {
      throw new Error("Reflection evidence does not prove the scoped repeated pattern.");
    }
    const evidenceConfidence = evidence.flatMap((reflection) =>
      reflection.confidence == null ? [] : [reflection.confidence],
    );
    const confidence = evidenceConfidence.length > 0
      ? evidenceConfidence.reduce((sum, value) => sum + value, 0) / evidenceConfidence.length
      : 0.5;
    const existingSkill = await tx.skill.findFirst({
      where: { evidenceLinks: { has: sentinel }, status: { not: "rolled_back" } },
    });
    if (existingSkill) {
      const existingCandidate = await tx.learningCandidate.findFirst({
        where: {
          type: "skill",
          proposedPayload: { path: ["skillId"], equals: existingSkill.id },
        },
        orderBy: { createdAt: "desc" },
      });
      if (!existingCandidate) {
        throw new Error(
          `Skill ${existingSkill.id} already owns this opportunity but has no candidate; repair is required.`,
        );
      }
      return { skill: existingSkill, candidate: existingCandidate, created: false };
    }

    const skill = await tx.skill.create({
      data: {
        name: input.name.trim(),
        description: input.description.trim(),
        domain: input.domain.trim(),
        status: "proposed",
        owner: input.agentId,
        evidenceLinks: [
          sentinel,
          ...evidence.map((reflection) => `reflection:${reflection.id}`),
        ],
        inputSchema: input.inputSchema as Prisma.InputJsonValue,
        outputSchema: input.outputSchema as Prisma.InputJsonValue,
        permissions: permissionRisk.permissions,
        tests: [input.testCommand] as Prisma.InputJsonValue,
      },
    });
    const version = await createSkillVersion(skill.id, {
      implementationType: "command",
      implementation: { command: input.implementationCommand },
      dependencies: input.dependencies ?? [],
      inputSchema: input.inputSchema,
      outputSchema: input.outputSchema,
      permissions: permissionRisk.permissions,
      tests: [input.testCommand],
      approvalLevel: permissionRisk.riskLevel === "high" ? 3 : 2,
    }, { transaction: tx, deferActivation: true });
    const proposal = await proposeCandidate({
      type: "skill",
      targetType: "skill",
      riskLevel: permissionRisk.riskLevel,
      evidenceCount: evidence.length,
      confidence,
      problem: `Repeated reflection pattern: ${input.summary}`,
      proposedPayload: {
        generationPipeline: "safe_skill_generation",
        pipelineStage: "proposed",
        opportunityKey: input.opportunityKey,
        skillId: skill.id,
        skillVersionId: version.id,
        agentId: input.agentId,
        workspaceId: input.workspaceId,
        projectId: input.projectId,
        permissions: permissionRisk.permissions,
        requestedPermissions: input.requestedPermissions,
        sensitivePermissions: permissionRisk.sensitivePermissions,
        inputSchema: input.inputSchema,
        outputSchema: input.outputSchema,
        implementationCommand: input.implementationCommand,
        testCommand: input.testCommand,
      },
    }, { transaction: tx, emitEvent: false });
    return { skill, candidate: proposal.candidate, created: true };
  });

  if (result.created) {
    await emitNeuralEvent({
      type: "learning.proposed",
      payload: {
        candidateId: result.candidate.id,
        type: "skill",
        riskLevel: result.candidate.riskLevel,
        autoApplied: false,
        approvalRequestId: result.candidate.approvalRequestId,
      },
    });
  }
  return result;
}

/**
 * Run the executable proposal through the real sandbox boundary, its tests,
 * an existing benchmark comparison, and recorded-fixture shadow evaluation.
 * Passing reaches awaiting_approval only; activation remains the generic
 * human LearningCandidate review transition.
 */
export async function runSkillGenerationPipeline(input: RunSkillGenerationPipelineInput) {
  const candidate = await db.learningCandidate.findUniqueOrThrow({
    where: { id: input.candidateId },
  });
  const payload = candidate.proposedPayload as Record<string, unknown>;
  if (
    candidate.type !== "skill" ||
    candidate.status !== "proposed" ||
    payload.generationPipeline !== "safe_skill_generation"
  ) {
    throw new Error("Candidate is not an open safe-skill-generation proposal.");
  }
  const skillId = requiredString(payload.skillId, "skillId");
  const skillVersionId = requiredString(payload.skillVersionId, "skillVersionId");
  const permissions = classifySkillPermissionRisk(
    payload.permissions,
    payload.requestedPermissions,
  );
  if (candidate.riskLevel !== permissions.riskLevel) {
    throw new Error("Stored candidate risk does not match its declared permissions.");
  }
  const implementationCommand = commandFrom(payload.implementationCommand, "implementationCommand");
  const testCommand = commandFrom(payload.testCommand, "testCommand");
  const sandbox = getSandbox();
  if (!sandbox.isProductionSafe && process.env.NODE_ENV !== "test") {
    return failPipeline(candidate.id, skillVersionId, "sandbox_failed", [
      "No production-safe sandbox is configured.",
    ]);
  }

  const implementationValidation = await sandbox.validate({ command: implementationCommand });
  const testValidation = await sandbox.validate({ command: testCommand });
  const validationReasons = [
    ...implementationValidation.reasons,
    ...testValidation.reasons,
  ];
  if (!implementationValidation.valid || !testValidation.valid) {
    return failPipeline(candidate.id, skillVersionId, "sandbox_failed", validationReasons);
  }

  const implementationRun = await sandbox.execute({ command: implementationCommand });
  const testRun = await sandbox.execute({ command: testCommand });
  await Promise.all([
    sandbox.destroy(implementationRun.runId),
    sandbox.destroy(testRun.runId),
  ]);
  const sandboxPassed =
    implementationRun.status === "completed" &&
    implementationRun.exitCode === 0 &&
    testRun.status === "completed" &&
    testRun.exitCode === 0;
  if (!sandboxPassed) {
    return failPipeline(candidate.id, skillVersionId, "tests_failed", [
      implementationRun.reason ?? (implementationRun.stderr || "Implementation execution failed."),
      testRun.reason ?? (testRun.stderr || "Sandboxed tests failed."),
    ]);
  }
  await db.skillVersion.update({
    where: { id: skillVersionId },
    data: { status: "candidate" },
  });
  await updatePipelineStage(candidate.id, "tests_passed", {
    sandbox: sandbox.name,
    implementationRunId: implementationRun.runId,
    testRunId: testRun.runId,
    pipelineReasons: [],
  });

  const benchmark = await evaluatePromotion({
    benchmarkId: input.benchmarkId,
    candidateId: candidate.id,
  });
  const benchmarkResults = await db.benchmarkResult.findMany({
    where: { benchmarkId: input.benchmarkId, candidateId: candidate.id },
    select: { id: true },
  });
  await db.skillVersion.update({
    where: { id: skillVersionId },
    data: { benchmarkResultIds: benchmarkResults.map((result) => result.id) },
  });
  if (!benchmark.passed) {
    return failPipeline(candidate.id, skillVersionId, "benchmark_failed", benchmark.reasons);
  }

  const sourceExperienceIds = [...new Set(input.sourceExperienceIds.map((id) => id.trim()))]
    .filter(Boolean);
  const fixtureAgentId = requiredString(payload.agentId, "agentId");
  const fixtureWorkspaceId = nullableString(payload.workspaceId);
  const fixtureProjectId = nullableString(payload.projectId);
  const [definition, fixtures] = await Promise.all([
    db.benchmarkDefinition.findUniqueOrThrow({ where: { id: input.benchmarkId } }),
    db.experience.findMany({ where: { id: { in: sourceExperienceIds } } }),
  ]);
  if (definition.workspaceId && definition.workspaceId !== fixtureWorkspaceId) {
    throw new Error("Benchmark definition is outside the generated skill's workspace.");
  }
  if (
    fixtures.length !== sourceExperienceIds.length ||
    fixtures.some((fixture) =>
      fixture.agentId !== fixtureAgentId ||
      fixture.workspaceId !== fixtureWorkspaceId ||
      (fixtureProjectId !== null && fixture.projectId !== fixtureProjectId) ||
      fixture.outcomeStatus === "in_progress"
    )
  ) {
    throw new Error("Shadow fixtures must be completed experiences in the same agent scope.");
  }
  const existingShadowTraceIds = new Set(
    (await listShadowRuns(candidate.id)).flatMap((run) => run.traceId ? [run.traceId] : []),
  );
  for (const sourceExperienceId of sourceExperienceIds) {
    if (existingShadowTraceIds.has(sourceExperienceId)) continue;
    await runShadowSample({ candidateId: candidate.id, sourceExperienceId });
  }
  const shadow = await evaluateShadowPromotion(candidate.id);
  await db.skillVersion.update({
    where: { id: skillVersionId },
    data: { status: "shadow" },
  });
  if (!shadow.passed) {
    const stage = shadow.sampleSize < 5 ? "shadow_pending" : "shadow_failed";
    return failPipeline(candidate.id, skillVersionId, stage, shadow.reasons, "shadow");
  }

  await updatePipelineStage(candidate.id, "awaiting_approval", {
    benchmark,
    shadow,
    skillId,
    skillVersionId,
    pipelineReasons: [],
  });
  return {
    passed: true,
    stage: "awaiting_approval",
    needsApproval: true,
    reasons: [],
    benchmark,
    shadow,
  };
}

export async function listSkillGenerationProposals(limit = 100) {
  const candidates = await db.learningCandidate.findMany({
    where: { type: "skill" },
    include: { approvalRequest: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(limit, 1), 250),
  });
  const generated = candidates.filter((candidate) => {
    const payload = candidate.proposedPayload as Record<string, unknown>;
    return payload.generationPipeline === "safe_skill_generation";
  });
  const skillIds = generated.flatMap((candidate) => {
    const id = (candidate.proposedPayload as Record<string, unknown>).skillId;
    return typeof id === "string" ? [id] : [];
  });
  const skills = await db.skill.findMany({ where: { id: { in: skillIds } } });
  const skillsById = new Map(skills.map((skill) => [skill.id, skill]));
  return generated.map((candidate) => {
    const payload = candidate.proposedPayload as Record<string, unknown>;
    const skillId = typeof payload.skillId === "string" ? payload.skillId : "";
    return {
      candidateId: candidate.id,
      candidateStatus: candidate.status,
      riskLevel: candidate.riskLevel,
      pipelineStage: typeof payload.pipelineStage === "string" ? payload.pipelineStage : "unknown",
      pipelineReasons: Array.isArray(payload.pipelineReasons) ? payload.pipelineReasons : [],
      skill: skillsById.get(skillId) ?? null,
      skillVersionId:
        typeof payload.skillVersionId === "string" ? payload.skillVersionId : null,
      approvalRequest: candidate.approvalRequest,
      createdAt: candidate.createdAt,
    };
  });
}

async function findExistingSkillWithLock(opportunityKey: string): Promise<string | null> {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill-opportunity:${opportunityKey}`})) IS NULL AS locked`;
    const skill = await tx.skill.findFirst({
      where: {
        evidenceLinks: { has: `${OPPORTUNITY_PREFIX}${opportunityKey}` },
        status: { not: "rolled_back" },
      },
      select: { id: true },
    });
    return skill?.id ?? null;
  });
}

function skillOpportunityKey(input: {
  topic: string;
  agentId: string;
  workspaceId: string | null;
  projectId: string | null;
}): string {
  return createHash("sha256")
    .update(JSON.stringify([
      input.agentId,
      input.workspaceId,
      input.projectId,
      normalizeSkillTopic(input.topic),
    ]))
    .digest("hex");
}

function validateProposalInput(input: ProposeSkillFromPatternInput) {
  requiredString(input.name, "name");
  requiredString(input.description, "description");
  requiredString(input.domain, "domain");
  if (!isPlainObject(input.inputSchema) || !isPlainObject(input.outputSchema)) {
    throw new Error("inputSchema and outputSchema must be explicit JSON objects.");
  }
  commandFrom(input.implementationCommand, "implementationCommand");
  commandFrom(input.testCommand, "testCommand");
  if (input.reflectionIds.length < MIN_PATTERN_OCCURRENCES) {
    throw new Error(`At least ${MIN_PATTERN_OCCURRENCES} reflection ids are required.`);
  }
}

function commandFrom(value: unknown, field: string): string[] {
  if (
    !Array.isArray(value) ||
    value.length === 0 ||
    value.some((entry) => typeof entry !== "string" || !entry.trim())
  ) {
    throw new Error(`${field} must be a non-empty command array.`);
  }
  return value.map((entry) => entry.trim());
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) {
    throw new Error(`${field} is required.`);
  }
  return value.trim();
}

function nullableString(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function reflectionSkillTopic(reflection: {
  reusableLesson: string | null;
  suggestedImprovement: string | null;
  summary: string;
}): string {
  return (
    reflection.reusableLesson?.trim() ||
    reflection.suggestedImprovement?.trim() ||
    reflection.summary.trim()
  );
}

async function failPipeline(
  candidateId: string,
  skillVersionId: string,
  stage: string,
  reasons: string[],
  versionStatus: "draft" | "candidate" | "shadow" = "draft",
) {
  await Promise.all([
    db.skillVersion.update({
      where: { id: skillVersionId },
      data: { status: versionStatus },
    }),
    updatePipelineStage(candidateId, stage, { pipelineReasons: reasons }),
  ]);
  return { passed: false, stage, needsApproval: false, reasons };
}

async function updatePipelineStage(
  candidateId: string,
  pipelineStage: string,
  details: Record<string, unknown> = {},
) {
  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`skill-pipeline:${candidateId}`})) IS NULL AS locked`;
    const candidate = await tx.learningCandidate.findUniqueOrThrow({
      where: { id: candidateId },
      select: { proposedPayload: true },
    });
    const payload = candidate.proposedPayload as Record<string, unknown>;
    return tx.learningCandidate.update({
      where: { id: candidateId },
      data: {
        proposedPayload: {
          ...payload,
          ...details,
          pipelineStage,
        } as Prisma.InputJsonValue,
      },
    });
  });
}
