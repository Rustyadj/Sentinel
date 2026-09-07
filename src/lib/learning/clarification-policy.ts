import { createHash } from "node:crypto";
import type { Prisma, LearningCandidate } from "@prisma/client";

/** Called only inside the canonical applyLearningCandidate transaction. */
export async function applyClarificationPolicy(tx: Prisma.TransactionClient, candidate: LearningCandidate) {
  const payload = candidate.proposedPayload as Record<string, unknown>;
  const threshold = payload.curiosityThreshold ?? payload.threshold;
  if (typeof threshold !== "number" || !Number.isFinite(threshold) || threshold < 0 || threshold > 1) throw new Error("Invalid clarification threshold");
  if (candidate.status !== "approved" || candidate.survivalStatus !== "champion") throw new Error("Clarification policy requires a human-approved champion");
  const agentId = typeof payload.agentId === "string" ? payload.agentId : null;
  if (!agentId) throw new Error("Clarification policy requires target agentId");
  const agent = await tx.agent.findUniqueOrThrow({ where: { id: agentId } });
  const source = await tx.learningCandidate.findUniqueOrThrow({ where: { id: candidate.id }, include: { experience: true, approvalRequest: true } });
  const workspaceId = source.approvalRequest?.workspaceId ?? source.experience?.workspaceId ?? payload.workspaceId;
  if (!agent.workspaceId || workspaceId !== agent.workspaceId) throw new Error("Clarification target must belong to the approved workspace");
  const guardian = await tx.guardianDecision.findFirst({ where: { candidateId: candidate.id }, orderBy: { createdAt: "desc" } });
  if (!guardian || guardian.guardianDecision !== "allow" || guardian.blocked) throw new Error("Clarification policy requires Guardian allow");
  if (typeof payload.featureFlagKey !== "string") throw new Error("Clarification policy requires a canary feature flag");
  const flag = await tx.featureFlag.findUnique({ where: { key: payload.featureFlagKey } });
  if (!flag || flag.learningCandidateId !== candidate.id || !((flag.scopeType === "agent" && flag.scopeId === agentId) || (flag.scopeType === "workspace" && flag.scopeId === agent.workspaceId))) throw new Error("Feature flag must govern this candidate and target scope");
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${`clarification-policy:${agentId}`})) IS NULL AS locked`;
  const previous = await tx.learningArtifactVersion.findFirst({ where: { artifactType: "clarification_policy", artifactKey: agentId }, orderBy: { version: "desc" } });
  const content = { curiosityThreshold: threshold, featureFlagKey: flag.key };
  const artifact = await tx.learningArtifactVersion.create({ data: {
    artifactType: "clarification_policy", artifactKey: agentId, candidateId: candidate.id,
    version: (previous?.version ?? 0) + 1, previousVersionId: previous?.id,
    content, checksum: createHash("sha256").update(JSON.stringify(content)).digest("hex"), status: "active", activatedAt: new Date(),
  } });
  return artifact.id;
}
