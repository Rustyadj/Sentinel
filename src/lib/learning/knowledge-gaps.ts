import { db } from "@/lib/db";
import { type AccessibleLearningScope, buildLearningScopeWhere } from "./authorization";

const DEFAULT_LOOKBACK_DAYS = 30;
const LOW_CONFIDENCE_THRESHOLD = 0.5;
const FREQUENCY_SATURATION = 5;
const MIN_REPEATED_OCCURRENCES = 2;
const GAP_TRIGGER_TYPES = [
  "unknown_term",
  "missing_constraint",
  "incomplete_context",
  "low_confidence",
  "conflicting_memory",
] as const;

export interface DetectKnowledgeGapsParams {
  agentId?: string;
  workspaceId?: string;
  projectId?: string;
  since?: Date;
  limit?: number;
}

export interface ListKnowledgeGapsParams {
  agentId?: string;
  workspaceId?: string;
  projectId?: string;
  status?: string;
  limit?: number;
  scope?: AccessibleLearningScope;
}

interface GapOccurrence {
  agentId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  topic: string;
  description: string;
  source: "curiosity" | "reflection";
  provenance: string;
  businessImpact: number | null;
  failure: boolean;
}

interface GapGroup {
  agentId: string | null;
  workspaceId: string | null;
  projectId: string | null;
  topic: string;
  description: string;
  occurrences: GapOccurrence[];
}

export function normalizeGapTopic(topic: string): string {
  return topic.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Detect repeated knowledge gaps from real Curiosity and Reflection evidence.
 * Topic matching is intentionally exact after lowercase/trim normalization;
 * lexical similarity can be added later without changing persistence rules.
 */
export async function detectKnowledgeGaps(params: DetectKnowledgeGapsParams = {}) {
  const since = params.since ?? new Date(Date.now() - DEFAULT_LOOKBACK_DAYS * 24 * 60 * 60 * 1000);
  const take = Math.min(Math.max(params.limit ?? 500, 1), 1000);
  const scope = {
    ...(params.agentId ? { agentId: params.agentId } : {}),
    ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
    ...(params.projectId ? { projectId: params.projectId } : {}),
    createdAt: { gte: since },
  };

  const [curiosityEvents, reflections] = await Promise.all([
    db.curiosityEvent.findMany({
      where: {
        ...scope,
        OR: [
          { confidenceBefore: { lte: LOW_CONFIDENCE_THRESHOLD } },
          { triggerType: { in: [...GAP_TRIGGER_TYPES] } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
    db.reflection.findMany({
      where: {
        ...scope,
        OR: [{ whatFailed: { not: null } }, { missingInformation: { not: null } }],
      },
      orderBy: { createdAt: "desc" },
      take,
    }),
  ]);

  const occurrences: GapOccurrence[] = [];
  for (const event of curiosityEvents) {
    const description = event.question?.trim() || event.reason?.trim() || event.triggerType.replaceAll("_", " ");
    const topic = normalizeGapTopic(description);
    if (!topic) continue;
    occurrences.push({
      agentId: event.agentId,
      workspaceId: event.workspaceId,
      projectId: event.projectId,
      topic,
      description,
      source: "curiosity",
      provenance: `curiosity:${event.id}`,
      businessImpact: event.businessImpactScore,
      failure: false,
    });
  }
  for (const reflection of reflections) {
    const fields = [
      ["missing-information", reflection.missingInformation],
      ["what-failed", reflection.whatFailed],
    ] as const;
    for (const [field, value] of fields) {
      const description = value?.trim();
      if (!description) continue;
      occurrences.push({
        agentId: reflection.agentId,
        workspaceId: reflection.workspaceId,
        projectId: reflection.projectId,
        topic: normalizeGapTopic(description),
        description,
        source: "reflection",
        provenance: `reflection:${reflection.id}`,
        businessImpact: null,
        failure: field === "what-failed",
      });
    }
  }

  const groups = groupOccurrences(occurrences);
  const gaps = [];
  for (const group of groups.values()) {
    if (group.occurrences.length < MIN_REPEATED_OCCURRENCES) continue;
    gaps.push(await mergeGapGroup(group));
  }
  return gaps;
}

export function listKnowledgeGaps(params: ListKnowledgeGapsParams = {}) {
  return db.knowledgeGap.findMany({
    where: {
      ...(params.agentId ? { agentId: params.agentId } : {}),
      ...(params.workspaceId ? { workspaceId: params.workspaceId } : {}),
      ...(params.projectId ? { projectId: params.projectId } : {}),
      ...(params.status ? { status: params.status } : {}),
      ...(params.scope
        ? buildLearningScopeWhere(params.scope, { workspaceId: true, projectId: true, agentId: true })
        : {}),
    },
    orderBy: [{ priorityScore: "desc" }, { updatedAt: "desc" }],
    take: Math.min(Math.max(params.limit ?? 100, 1), 250),
  });
}

export function calculateGapPriority(frequency: number, businessImpact: number | null): number {
  const frequencyScore = Math.min(Math.max(frequency, 0) / FREQUENCY_SATURATION, 1);
  const impactScore = Math.min(Math.max(businessImpact ?? 0, 0), 1);
  return Math.round((frequencyScore * 0.7 + impactScore * 0.3) * 1000) / 1000;
}

function groupOccurrences(occurrences: GapOccurrence[]): Map<string, GapGroup> {
  const groups = new Map<string, GapGroup>();
  for (const occurrence of occurrences) {
    const key = JSON.stringify([
      occurrence.agentId,
      occurrence.workspaceId,
      occurrence.projectId,
      occurrence.topic,
    ]);
    const existing = groups.get(key);
    if (existing) {
      const duplicate = existing.occurrences.find(
        (candidate) => candidate.provenance === occurrence.provenance,
      );
      if (duplicate) {
        duplicate.failure ||= occurrence.failure;
      } else {
        existing.occurrences.push(occurrence);
      }
    } else {
      groups.set(key, {
        agentId: occurrence.agentId,
        workspaceId: occurrence.workspaceId,
        projectId: occurrence.projectId,
        topic: occurrence.topic,
        description: occurrence.description,
        occurrences: [occurrence],
      });
    }
  }
  return groups;
}

async function mergeGapGroup(group: GapGroup) {
  const lockKey = `knowledge-gap:${JSON.stringify([
    group.agentId,
    group.workspaceId,
    group.projectId,
    group.topic,
  ])}`;

  return db.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${lockKey})) IS NULL AS locked`;
    const existing = await tx.knowledgeGap.findFirst({
      where: {
        agentId: group.agentId,
        workspaceId: group.workspaceId,
        projectId: group.projectId,
        topic: group.topic,
        status: { notIn: ["resolved", "dismissed"] },
      },
      orderBy: { createdAt: "asc" },
    });

    // There is no source-event join model yet. Prefixed event ids in the
    // existing relatedTraceIds array are the smallest idempotent provenance
    // representation available; a later schema can split source ids from
    // actual trace ids without changing gap identity or frequency semantics.
    const knownProvenance = new Set(existing?.relatedTraceIds ?? []);
    const newOccurrences = group.occurrences.filter(
      (occurrence) => !knownProvenance.has(occurrence.provenance),
    );
    if (existing && newOccurrences.length === 0) return existing;

    const relatedTraceIds = [
      ...knownProvenance,
      ...newOccurrences.map((occurrence) => occurrence.provenance),
    ];
    const frequency = (existing?.frequency ?? 0) + newOccurrences.length;
    const observedImpacts = [
      ...(existing?.businessImpact == null ? [] : [existing.businessImpact]),
      ...newOccurrences.flatMap((occurrence) =>
        occurrence.businessImpact == null ? [] : [occurrence.businessImpact],
      ),
    ];
    const businessImpact = observedImpacts.length > 0 ? Math.max(...observedImpacts) : null;
    const priorityScore = calculateGapPriority(frequency, businessImpact);
    const allSources = new Set([
      ...(existing?.source?.split(",").filter(Boolean) ?? []),
      ...newOccurrences.map((occurrence) => occurrence.source),
    ]);
    const previousFailureCount = (existing?.failureImpact ?? 0) * (existing?.frequency ?? 0);
    const newFailureCount = newOccurrences.filter((occurrence) => occurrence.failure).length;
    const failureImpact = frequency > 0 ? (previousFailureCount + newFailureCount) / frequency : null;
    const data = {
      description: existing?.description ?? group.description,
      source: [...allSources].sort().join(","),
      frequency,
      businessImpact,
      failureImpact,
      confidence: Math.min(frequency / FREQUENCY_SATURATION, 1),
      priorityScore,
      recommendedAction:
        priorityScore >= 0.65
          ? "Create a scoped learning goal and gather authoritative sources."
          : "Collect more repeated evidence before scheduling research.",
      relatedTraceIds,
    };

    if (existing) {
      return tx.knowledgeGap.update({ where: { id: existing.id }, data });
    }
    return tx.knowledgeGap.create({
      data: {
        agentId: group.agentId,
        workspaceId: group.workspaceId,
        projectId: group.projectId,
        topic: group.topic,
        ...data,
      },
    });
  });
}
