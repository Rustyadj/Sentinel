import type { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { ingestSource } from "./ingestion";
import { createSkillCandidate } from "./skill-refinery";
import { requireAdaptiveScope } from "./scope";
import { assertInputSize, redactSecrets } from "./security";

export const PACKAGE_VERSION = "sentinel.package.v1";

export async function exportPackage(kind: string, id: string, actorUserId: string) {
  let payload: unknown;
  if (kind === "skill") {
    const candidate = await db.skillCandidate.findFirstOrThrow({ where: { promotedSkillId: id } });
    await requireAdaptiveScope({ actorUserId, workspaceId: candidate.workspaceId, projectId: candidate.projectId, permission: "knowledge.read" });
    payload = { skill: await db.skill.findUniqueOrThrow({ where: { id } }), versions: await db.skillVersion.findMany({ where: { skillId: id }, orderBy: { version: "asc" } }), admission: candidate };
  } else if (kind === "workflow") {
    const workflow = await db.workflow.findUniqueOrThrow({ where: { id } });
    await requireAdaptiveScope({ actorUserId, workspaceId: workflow.workspaceId, projectId: workflow.projectId, permission: "workflow.read" });
    payload = { workflow, runs: await db.workflowRun.findMany({ where: { workflowId: id }, orderBy: { createdAt: "desc" }, take: 100 }) };
  } else if (kind === "retrieval-trace") {
    const trace = await db.retrievalTrace.findUniqueOrThrow({ where: { id }, include: { items: { orderBy: { rank: "asc" } } } });
    await requireAdaptiveScope({ actorUserId, workspaceId: trace.workspaceId, projectId: trace.projectId, userId: trace.userId, permission: "knowledge.read" });
    payload = trace;
  } else if (kind === "evaluation") {
    const evaluation = await db.evaluation.findUniqueOrThrow({ where: { id }, include: { experience: true } });
    await requireAdaptiveScope({ actorUserId, workspaceId: evaluation.experience.workspaceId, projectId: evaluation.experience.projectId, permission: "run.read" });
    payload = evaluation;
  } else if (kind === "agent-profile") {
    const agent = await db.agent.findUniqueOrThrow({ where: { id } });
    if (!agent.workspaceId) throw new Error("Unscoped agent profiles are not exportable.");
    await requireAdaptiveScope({ actorUserId, workspaceId: agent.workspaceId, permission: "agent.read" });
    payload = { agent: { id: agent.id, name: agent.name, role: agent.role, model: agent.model, skills: agent.skills, toolPermissions: agent.toolPermissions },
      profile: await db.agentKnowledgeProfile.findUnique({ where: { agentId: id } }),
      competencies: await db.agentCompetency.findMany({ where: { agentId: id } }) };
  } else throw new Error("Unsupported export kind.");
  return redactSecrets({ packageVersion: PACKAGE_VERSION, kind, exportedAt: new Date().toISOString(), payload });
}

export async function importPackage(input: {
  packageVersion?: string; kind: string; payload: Record<string, unknown>;
  organizationId?: string; workspaceId?: string; projectId?: string; actorUserId: string;
}) {
  const serialized = JSON.stringify(input.payload);
  assertInputSize(serialized, 2_000_000);
  await requireAdaptiveScope({ ...input, permission: input.kind.includes("workflow") ? "workflow.write" : "knowledge.write" });
  if (input.kind === "memory-markdown") {
    return ingestSource({ sourceSystem: "import", sourceId: String(input.payload.sourceId ?? crypto.randomUUID()),
      title: String(input.payload.title ?? "Imported memory"), mimeType: "text/markdown",
      content: String(input.payload.content ?? ""), organizationId: input.organizationId,
      workspaceId: input.workspaceId, projectId: input.projectId, actorUserId: input.actorUserId });
  }
  if (input.kind === "agentskills" || input.kind === "sentinel-skill") {
    const candidate = await createSkillCandidate({
      organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
      name: String(input.payload.name ?? "Imported skill"), description: String(input.payload.description ?? "Imported skill package"),
      purpose: String(input.payload.purpose ?? input.payload.description ?? "Imported procedure"),
      triggerConditions: Array.isArray(input.payload.triggerConditions) ? input.payload.triggerConditions.map(String) : [],
      prerequisites: Array.isArray(input.payload.prerequisites) ? input.payload.prerequisites.map(String) : [],
      inputs: Array.isArray(input.payload.inputs) ? input.payload.inputs : [], outputs: Array.isArray(input.payload.outputs) ? input.payload.outputs : [],
      steps: Array.isArray(input.payload.steps) ? input.payload.steps : [],
      toolPermissions: Array.isArray(input.payload.toolPermissions) ? input.payload.toolPermissions.map(String) : [],
      approvalRequirements: ["Imported skills require human review"], sourceRunIds: [], sourceEvidenceIds: [],
      expectedSuccessCriteria: [], verificationSteps: [], rollbackSteps: Array.isArray(input.payload.rollbackSteps) ? input.payload.rollbackSteps.map(String) : [],
      risk: 0.8, confidence: 0.2, proposedBy: input.actorUserId,
    }, input.actorUserId);
    return db.skillCandidate.update({ where: { id: candidate.id }, data: {
      status: "draft", securityFindings: [...(candidate.securityFindings as Prisma.JsonArray), { code: "import_requires_review", excerpt: "Imported skills never activate automatically." }] as Prisma.InputJsonValue,
    }});
  }
  if (input.kind === "workflow") {
    return db.workflowProposal.create({ data: {
      organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
      ownerUserId: input.actorUserId, trigger: (input.payload.trigger ?? {}) as Prisma.InputJsonValue,
      inputs: (input.payload.inputs ?? {}) as Prisma.InputJsonValue,
      tools: Array.isArray(input.payload.tools) ? input.payload.tools.map(String) : [],
      requiredCredentials: Array.isArray(input.payload.requiredCredentials) ? input.payload.requiredCredentials.map(String) : [],
      readScope: { imported: true }, writeScope: { allowed: false }, approvalPoints: [{ before: "activation" }],
      expectedOutput: (input.payload.expectedOutput ?? {}) as Prisma.InputJsonValue,
      verification: (input.payload.verification ?? { required: true }) as Prisma.InputJsonValue,
      failureHandling: { imported: true, disabled: true }, rollback: (input.payload.rollback ?? { required: true }) as Prisma.InputJsonValue,
      schedule: typeof input.payload.schedule === "string" ? input.payload.schedule : null,
      repetitionCount: 0, confidence: 0.2, status: "proposed",
    }});
  }
  return ingestSource({ sourceSystem: "import", sourceId: crypto.randomUUID(),
    title: `Imported ${input.kind}`, mimeType: "application/json", content: serialized,
    organizationId: input.organizationId, workspaceId: input.workspaceId,
    projectId: input.projectId, actorUserId: input.actorUserId, sensitivity: "restricted" });
}
