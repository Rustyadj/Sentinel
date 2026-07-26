import { db } from "@/lib/db";
import { proposeMemoryCandidate } from "./memory-candidate-service";
import { createSkillCandidate, type SkillCandidateInput } from "./skill-refinery";
import { emitAdaptiveEvent } from "./event-service";

export function shouldReflect(run: {
  outcomeStatus: string; toolsUsed: string[]; cost: number | null; latencyMs: number | null;
  userFeedback: string | null; actionsTaken: unknown;
}) {
  const actions = Array.isArray(run.actionsTaken) ? run.actionsTaken.length : 0;
  return run.outcomeStatus === "failure" || run.outcomeStatus === "partial" ||
    run.toolsUsed.length >= 3 || actions >= 5 || (run.cost ?? 0) >= Number(process.env.REFLECTION_COST_THRESHOLD ?? 2) ||
    (run.latencyMs ?? 0) >= Number(process.env.REFLECTION_RUNTIME_THRESHOLD_MS ?? 120_000) || Boolean(run.userFeedback);
}

export async function reflectExperience(input: {
  experienceId: string; actorUserId: string;
  observations?: Array<{ content: string; type: "fact" | "lesson" | "correction" | "summary"; confidence: number; evidenceIds: string[] }>;
  skillCandidate?: Omit<SkillCandidateInput, "sourceRunIds" | "proposedBy">;
}) {
  const run = await db.experience.findUniqueOrThrow({ where: { id: input.experienceId }, include: { evaluations: true, outcome: true } });
  if (!shouldReflect(run)) return { reflected: false, reason: "run_not_significant", memoryCandidates: [], skillCandidate: null };
  const candidates = [];
  for (const observation of input.observations ?? []) {
    candidates.push(await proposeMemoryCandidate({
      organizationId: run.organizationId ?? undefined, workspaceId: run.workspaceId ?? undefined,
      projectId: run.projectId ?? undefined, agentId: run.agentId, runId: run.id,
      conversationId: run.conversationId ?? undefined, candidateType: observation.type,
      content: observation.content, sourceType: run.userFeedback ? "human_correction" : "evaluation",
      sourceTrust: run.userFeedback ? 0.9 : 0.7, confidence: observation.confidence,
      importance: 0.6, risk: 0.4,
      provenance: { sourceIds: [run.id], evidenceIds: observation.evidenceIds,
        capturedAt: new Date().toISOString() }, proposedBy: input.actorUserId,
    }, input.actorUserId));
  }
  const skill = input.skillCandidate ? await createSkillCandidate({ ...input.skillCandidate,
    sourceRunIds: [run.id], proposedBy: input.actorUserId }, input.actorUserId) : null;
  await emitAdaptiveEvent({ type: "reflection.completed", userId: input.actorUserId,
    agentId: run.agentId, runId: run.id, workspaceId: run.workspaceId ?? undefined,
    projectId: run.projectId ?? undefined, payload: { memoryCandidateIds: candidates.map((candidate) => candidate.id), skillCandidateId: skill?.id ?? null } });
  return { reflected: true, memoryCandidates: candidates, skillCandidate: skill };
}
