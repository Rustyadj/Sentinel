import { db } from "@/lib/db";
import { proposeMemoryCandidate } from "./memory-candidate-service";
import { emitAdaptiveEvent } from "./event-service";

const normalize = (value: string) => value.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

export async function consolidateScope(input: {
  actorUserId: string; organizationId?: string; workspaceId?: string; projectId?: string;
}) {
  const objects = await db.knowledgeObject.findMany({ where: {
    validTo: null,
    ...(input.projectId ? { projectId: input.projectId } : input.workspaceId ? { workspaceId: input.workspaceId, projectId: null } : input.organizationId ? { organizationId: input.organizationId, workspaceId: null } : { userId: input.actorUserId }),
  }, orderBy: { updatedAt: "desc" }, take: 1000 });
  const groups = new Map<string, typeof objects>();
  for (const object of objects) {
    const key = `${object.type}:${normalize(object.title)}`;
    groups.set(key, [...(groups.get(key) ?? []), object]);
  }
  const duplicateGroups = [...groups.values()].filter((group) => group.length > 1);
  const proposals = [];
  for (const group of duplicateGroups.slice(0, 50)) {
    const [preferred, ...duplicates] = group;
    proposals.push(await proposeMemoryCandidate({
      organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
      candidateType: "relationship", content: `Consolidate exact-title duplicates into ${preferred.id}`,
      structuredPayload: { fromObjectId: duplicates[0].id, toObjectId: preferred.id, type: "supersedes", duplicateIds: duplicates.map((item) => item.id) },
      sourceType: "evaluation", sourceTrust: 0.8, confidence: 0.8, importance: 0.4, risk: 0.35,
      provenance: { sourceIds: group.map((item) => item.id), evidenceIds: group.map((item) => item.id), capturedAt: new Date().toISOString() },
      proposedBy: input.actorUserId,
    }, input.actorUserId));
  }
  await emitAdaptiveEvent({ type: "consolidation.completed", userId: input.actorUserId,
    organizationId: input.organizationId, workspaceId: input.workspaceId, projectId: input.projectId,
    payload: { objectsScanned: objects.length, duplicateGroups: duplicateGroups.length, proposalIds: proposals.map((item) => item.id) } });
  return { objectsScanned: objects.length, duplicateGroups: duplicateGroups.length, proposals };
}
