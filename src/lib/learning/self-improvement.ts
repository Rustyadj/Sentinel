// Learning Core — Self-Improvement Engine (co-occurrence relationship discovery)
//
// Closes a real, previously-dead-ended loop: individual knowledge-object
// confidence already updates automatically per outcome (see
// autoEvaluateExperience in neural-engine/evaluator.ts), but nothing ever
// looks at PAIRS of knowledge objects that repeatedly get used together and
// proposes the relationship itself. That's a genuine, low-risk, evidence-only
// self-improvement action: no LLM call, no invented content — the payload is
// just the two real KnowledgeObject ids and a real occurrence count pulled
// from Experience.knowledgeUsed.
//
// Reuses the existing LearningCandidate pipeline end to end: proposeCandidate
// classifies "relationship" as low-risk/auto-approvable (policy-service.ts),
// and applyLearningCandidate's existing "relationship" case already knows how
// to create/strengthen a KnowledgeEdge — no new apply logic was added here.

import { db } from "@/lib/db";
import { proposeCandidate } from "@/lib/neural-engine/learning-service";
import { type AccessibleLearningScope } from "./authorization";

const MIN_CO_OCCURRENCES = 3;
const RELATED_EDGE_TYPE = "related_to";
const MAX_EDGE_WEIGHT_FOR_REPROPOSAL = 0.95;
const LOOKBACK_DAYS = 60;
const MAX_EXPERIENCES_SCANNED = 2000;
const MAX_PAIRS_PER_RUN = 20;
const MAX_KNOWLEDGE_USED_PER_EXPERIENCE = 12; // caps pathological fan-out (n^2 pairs)
export const CO_OCCURRENCE_PIPELINE = "co_occurrence_self_improvement";

export interface DetectCoOccurrenceParams {
  agentId?: string;
  workspaceId?: string;
  projectId?: string;
  since?: Date;
  limit?: number;
}

export interface CoOccurrenceOpportunity {
  fromObjectId: string;
  toObjectId: string;
  occurrences: number;
  experienceIds: string[];
  agentId: string;
  workspaceId: string | null;
  projectId: string | null;
}

interface Bucket {
  occurrences: number;
  experienceIds: string[];
  agentId: string;
  workspaceId: string | null;
  projectId: string | null;
}

function pairKey(a: string, b: string): [string, string] {
  return a < b ? [a, b] : [b, a];
}

/**
 * Find pairs of knowledge objects repeatedly used together in the SAME
 * successful experience, scoped per-agent (a pattern one agent relies on
 * isn't assumed to hold for another). Real usage only — no inference beyond
 * counting Experience.knowledgeUsed co-membership.
 */
export async function detectCoOccurrenceOpportunities(
  params: DetectCoOccurrenceParams = {},
): Promise<CoOccurrenceOpportunity[]> {
  const since = params.since ?? new Date(Date.now() - LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const experiences = await db.experience.findMany({
    where: {
      outcomeStatus: "success",
      createdAt: { gte: since },
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
    },
    select: { id: true, agentId: true, workspaceId: true, projectId: true, knowledgeUsed: true },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(params.limit ?? MAX_EXPERIENCES_SCANNED, 1), MAX_EXPERIENCES_SCANNED),
  });

  const buckets = new Map<string, Bucket>();
  for (const experience of experiences) {
    const ids = [...new Set(experience.knowledgeUsed)];
    if (ids.length < 2 || ids.length > MAX_KNOWLEDGE_USED_PER_EXPERIENCE) continue;
    for (let i = 0; i < ids.length; i++) {
      for (let j = i + 1; j < ids.length; j++) {
        const [from, to] = pairKey(ids[i], ids[j]);
        const key = JSON.stringify([experience.agentId, from, to]);
        const existing = buckets.get(key);
        if (existing) {
          existing.occurrences += 1;
          existing.experienceIds.push(experience.id);
        } else {
          buckets.set(key, {
            occurrences: 1,
            experienceIds: [experience.id],
            agentId: experience.agentId,
            workspaceId: experience.workspaceId,
            projectId: experience.projectId,
          });
        }
      }
    }
  }

  const opportunities: CoOccurrenceOpportunity[] = [];
  for (const [key, bucket] of buckets) {
    if (bucket.occurrences < MIN_CO_OCCURRENCES) continue;
    const [, fromObjectId, toObjectId] = JSON.parse(key) as [string, string, string];
    opportunities.push({
      fromObjectId,
      toObjectId,
      occurrences: bucket.occurrences,
      experienceIds: bucket.experienceIds,
      agentId: bucket.agentId,
      workspaceId: bucket.workspaceId,
      projectId: bucket.projectId,
    });
  }
  return opportunities.sort((a, b) => b.occurrences - a.occurrences);
}

export interface ProposeFromCoOccurrenceResult {
  proposed: number;
  autoApplied: number;
  skipped: number;
}

/**
 * Turn detected opportunities into real LearningCandidate proposals.
 * `experienceId` is deliberately set to a real contributing experience —
 * without it these candidates would have no workspace/project/agent
 * relation and would silently fail to appear in any tenant-scoped view
 * (improvement queue, candidates list), which would make them real but
 * invisible instead of genuinely reviewable.
 *
 * Idempotency note: while an earlier proposal for the same pair is still
 * "proposed", this skips re-proposing rather than accumulating more evidence
 * onto it — a human can review what's there, or a later run will pick the
 * pair back up once that candidate resolves.
 */
export async function proposeRelationshipCandidatesFromCoOccurrence(
  opportunities: CoOccurrenceOpportunity[],
): Promise<ProposeFromCoOccurrenceResult> {
  let proposed = 0;
  let autoApplied = 0;
  let skipped = 0;

  for (const opportunity of opportunities.slice(0, MAX_PAIRS_PER_RUN)) {
    const [fromObject, toObject] = await Promise.all([
      db.knowledgeObject.findUnique({ where: { id: opportunity.fromObjectId }, select: { id: true } }),
      db.knowledgeObject.findUnique({ where: { id: opportunity.toObjectId }, select: { id: true } }),
    ]);
    if (!fromObject || !toObject) {
      skipped++;
      continue;
    }

    const existingEdge = await db.knowledgeEdge.findUnique({
      where: {
        fromObjectId_toObjectId_type: {
          fromObjectId: opportunity.fromObjectId,
          toObjectId: opportunity.toObjectId,
          type: RELATED_EDGE_TYPE,
        },
      },
      select: { weight: true },
    });
    if (existingEdge && existingEdge.weight >= MAX_EDGE_WEIGHT_FOR_REPROPOSAL) {
      skipped++;
      continue;
    }

    const opportunityKey = `${opportunity.fromObjectId}:${opportunity.toObjectId}:${RELATED_EDGE_TYPE}`;
    const existingPending = await db.learningCandidate.findFirst({
      where: {
        type: "relationship",
        status: "proposed",
        proposedPayload: { path: ["opportunityKey"], equals: opportunityKey },
      },
      select: { id: true },
    });
    if (existingPending) {
      skipped++;
      continue;
    }

    const confidence = Math.min(0.5 + opportunity.occurrences * 0.05, 0.95);
    const { autoApplied: applied } = await proposeCandidate({
      experienceId: opportunity.experienceIds[0],
      type: "relationship",
      targetType: "knowledge_edge",
      proposedPayload: {
        generationPipeline: CO_OCCURRENCE_PIPELINE,
        opportunityKey,
        fromObjectId: opportunity.fromObjectId,
        toObjectId: opportunity.toObjectId,
        edgeType: RELATED_EDGE_TYPE,
        weightDelta: 0.1,
        occurrences: opportunity.occurrences,
        sourceExperienceIds: opportunity.experienceIds,
      },
      problem: `Knowledge objects ${opportunity.fromObjectId} and ${opportunity.toObjectId} were jointly used in ${opportunity.occurrences} successful experiences by agent ${opportunity.agentId} but have no recorded "${RELATED_EDGE_TYPE}" relationship.`,
      evidenceCount: opportunity.occurrences,
      confidence,
    });
    proposed++;
    if (applied) autoApplied++;
  }

  return { proposed, autoApplied, skipped };
}

export async function runCoOccurrenceSelfImprovement(
  params: DetectCoOccurrenceParams = {},
): Promise<ProposeFromCoOccurrenceResult & { opportunitiesDetected: number }> {
  const opportunities = await detectCoOccurrenceOpportunities(params);
  const result = await proposeRelationshipCandidatesFromCoOccurrence(opportunities);
  return { ...result, opportunitiesDetected: opportunities.length };
}

/**
 * Real, tenant-scoped read of what this engine has actually proposed/applied
 * — for the API route and any future UI, not a separate log. `scope` is
 * required for HTTP callers (mirrors /api/learning/candidates): an unscoped
 * read here would hand back other tenants' knowledge-object ids.
 */
export function listSelfImprovementCandidates(params: {
  limit?: number;
  scope: AccessibleLearningScope;
}) {
  return db.learningCandidate.findMany({
    where: {
      type: "relationship",
      proposedPayload: { path: ["generationPipeline"], equals: CO_OCCURRENCE_PIPELINE },
      experience: {
        is: {
          OR: [
            { workspaceId: { in: params.scope.workspaceIds } },
            { projectId: { in: params.scope.projectIds } },
            { agentId: { in: params.scope.agentIds } },
          ],
        },
      },
    },
    orderBy: { createdAt: "desc" },
    take: Math.min(Math.max(params.limit ?? 50, 1), 200),
  });
}
