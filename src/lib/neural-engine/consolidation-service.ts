// Sentinel — consolidation.
//
// Runs in bounded cycles over recent experiences and decides what, if anything,
// should become durable knowledge. In shadow mode it computes and records
// everything but writes only memories flagged `shadowOnly`, which
// excludeFromRetrieval() keeps out of every production retrieval branch.
//
// The hard rules, in one place:
//   - Provenance is never destroyed. Source episodes outlive any abstraction
//     derived from them; the abstraction points back at every one of them.
//   - Generalization requires *independent* episodes. One experience retrieved
//     repeatedly is one piece of evidence, not many.
//   - Nothing here asserts truth. Surprise sets priority; evidence sets
//     confidence; neither is a claim that a generalization is correct.

import { db } from "@/lib/db";
import { coarseDomain } from "./evaluation-service";
import { provenanceTrustFor } from "./memory-provenance";

/** Minimum independent episodes before a pattern may be generalized at all. */
export const MIN_EPISODES_FOR_GENERALIZATION = 3;

/** Cap per cycle, so a cycle is bounded and restart-safe rather than a sweep. */
export const DEFAULT_CYCLE_LIMIT = 200;

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "to", "for", "of", "in", "on", "with", "this", "that",
  "is", "are", "be", "it", "at", "by", "from", "as", "into", "run", "make", "do",
]);

/**
 * Distinctive tokens of an objective, used to judge whether two episodes are
 * describing the same underlying problem.
 *
 * `coarseDomain` is a 40-character prefix — adequate as a competency key, far
 * too brittle to group episodes, since two reports of the same problem rarely
 * share their first 40 characters.
 */
export function objectiveTokens(objective: string): Set<string> {
  return new Set(
    objective
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((token) => token.length > 2 && !STOPWORDS.has(token)),
  );
}

/** Overlap of two token sets, 0..1. */
export function tokenSimilarity(a: Set<string>, b: Set<string>): number {
  if (!a.size || !b.size) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / (a.size + b.size - shared);
}

/**
 * How much wording two episodes must share before they are treated as the same
 * problem. Deliberately conservative: a threshold that is too low merges
 * unrelated work into a confident-sounding falsehood, which is far worse than
 * failing to generalize at all.
 *
 * This, and the token heuristic behind it, are the crudest part of the system
 * and the first thing to replace with a real domain taxonomy before anything is
 * promoted out of shadow. Clustering quality sets the ceiling on generalization
 * quality.
 */
export const SIMILARITY_THRESHOLD = 0.34;

export interface SurpriseInput {
  /** The agent's prior success rate in this domain, 0..1, or null if unknown. */
  priorSuccessRate: number | null;
  /** What actually happened, 0..1. */
  observedScore: number;
}

/**
 * Prediction error against what this agent's own history predicted.
 *
 * Both directions matter: an unexpected success is as informative as an
 * unexpected failure. With no prior, there is no expectation to violate, so
 * surprise is 0 rather than a fabricated maximum — an agent's first task is not
 * evidence of anything.
 */
export function predictionError({ priorSuccessRate, observedScore }: SurpriseInput): number {
  if (priorSuccessRate == null) return 0;
  return Math.min(1, Math.abs(priorSuccessRate - observedScore));
}

export interface ConsolidationCandidate {
  experienceId: string;
  agentId: string;
  domain: string;
  objective: string;
  succeeded: boolean;
  observedScore: number;
  predictionError: number;
  priority: number;
}

/**
 * Score an experience for consolidation priority.
 *
 * Surprise dominates deliberately: routine outcomes confirm what is already
 * known, while violated expectations are where the information is. Failures get
 * a modest additional weight because they tend to carry a specific, nameable
 * cause.
 */
export function consolidationPriority(candidate: Omit<ConsolidationCandidate, "priority">): number {
  const surprise = candidate.predictionError;
  const failureWeight = candidate.succeeded ? 0 : 0.15;
  return Math.min(1, surprise * 0.7 + failureWeight + 0.15);
}

/**
 * Select a bounded batch of unconsolidated experiences, highest priority first.
 * Only completed, evaluated experiences are eligible — an experience with no
 * outcome has nothing to teach yet.
 */
export async function selectConsolidationCandidates(limit = DEFAULT_CYCLE_LIMIT): Promise<ConsolidationCandidate[]> {
  const experiences = await db.experience.findMany({
    where: { consolidationState: "pending", completedAt: { not: null }, evaluatorScore: { not: null } },
    orderBy: { completedAt: "desc" },
    take: Math.min(Math.max(limit, 1), 1000),
    select: { id: true, agentId: true, objective: true, evaluatorScore: true, outcomeStatus: true },
  });
  if (!experiences.length) return [];

  const agentIds = [...new Set(experiences.map((e) => e.agentId))];
  const competencies = await db.agentCompetency.findMany({ where: { agentId: { in: agentIds } } });

  const candidates = experiences.map((experience) => {
    const competencyDomain = coarseDomain(experience.objective);
    const prior = competencies.find((c) => c.agentId === experience.agentId && c.domain === competencyDomain);
    const observedScore = experience.evaluatorScore ?? 0;
    // A competency with a single data point is not yet a prediction.
    const priorSuccessRate = prior && prior.evidenceCount >= 2 ? prior.successRate : null;
    const error = predictionError({ priorSuccessRate, observedScore });
    const base = {
      experienceId: experience.id,
      agentId: experience.agentId,
      domain: competencyDomain,
      objective: experience.objective,
      succeeded: observedScore >= 0.5,
      observedScore,
      predictionError: error,
    };
    return { ...base, priority: consolidationPriority(base) };
  });

  return candidates.sort((a, b) => b.priority - a.priority);
}

export interface EpisodeCluster {
  agentId: string;
  domain: string;
  succeeded: boolean;
  experienceIds: string[];
  meanScore: number;
}

/**
 * Group candidates into clusters that could support one generalization.
 *
 * Grouped by (agent, direction of outcome) and then by wording similarity: five
 * failures by one agent on one recurring problem are a pattern; a success and a
 * failure are not the same claim and must never be merged into one. Distinct
 * experience ids are the unit of evidence, so the same episode can never
 * inflate a cluster toward the threshold.
 */
export function clusterEpisodes(candidates: ConsolidationCandidate[]): EpisodeCluster[] {
  const byAgentDirection = new Map<string, ConsolidationCandidate[]>();
  for (const candidate of candidates) {
    const key = `${candidate.agentId}::${candidate.succeeded ? "success" : "failure"}`;
    byAgentDirection.set(key, [...(byAgentDirection.get(key) ?? []), candidate]);
  }

  const clusters: EpisodeCluster[] = [];
  for (const members of byAgentDirection.values()) {
    const buckets: Array<{ tokens: Set<string>; members: ConsolidationCandidate[] }> = [];
    for (const candidate of members) {
      const tokens = objectiveTokens(candidate.objective);
      const match = buckets.find((bucket) => tokenSimilarity(bucket.tokens, tokens) >= SIMILARITY_THRESHOLD);
      if (match) {
        match.members.push(candidate);
        for (const token of tokens) match.tokens.add(token);
      } else {
        buckets.push({ tokens: new Set(tokens), members: [candidate] });
      }
    }

    for (const bucket of buckets) {
      const experienceIds = [...new Set(bucket.members.map((m) => m.experienceId))];
      if (experienceIds.length < MIN_EPISODES_FOR_GENERALIZATION) continue;
      clusters.push({
        agentId: bucket.members[0].agentId,
        domain: [...bucket.tokens].sort().slice(0, 4).join("-") || "general",
        succeeded: bucket.members[0].succeeded,
        experienceIds,
        meanScore: bucket.members.reduce((sum, m) => sum + m.observedScore, 0) / bucket.members.length,
      });
    }
  }
  return clusters;
}

/**
 * Confidence in a generalization, from how much independent evidence stands
 * behind it. Deliberately capped below certainty: a pattern drawn from a
 * handful of episodes is a hypothesis, and the ceiling says so.
 */
export function generalizationConfidence(episodeCount: number): number {
  return Math.min(0.85, 0.35 + 0.1 * episodeCount);
}

export function describeCluster(cluster: EpisodeCluster): string {
  const verb = cluster.succeeded ? "consistently succeeds at" : "repeatedly fails at";
  return `${cluster.agentId} ${verb} ${cluster.domain} work (${cluster.experienceIds.length} independent episodes, mean outcome ${cluster.meanScore.toFixed(2)}).`;
}

export interface ConsolidationCycleResult {
  runId: string;
  mode: string;
  experiencesScanned: number;
  candidatesFound: number;
  memoriesGenerated: number;
  compressionRatio: number | null;
}

/**
 * One bounded consolidation cycle.
 *
 * Idempotent by construction: experiences are claimed out of `pending` as they
 * are processed, so a restart resumes rather than repeats, and an existing
 * generalization for the same cluster is updated with new evidence instead of
 * duplicated.
 */
export async function runConsolidationCycle(options: { limit?: number; mode?: "shadow" | "active" } = {}): Promise<ConsolidationCycleResult> {
  const mode = options.mode ?? "shadow";
  const run = await db.consolidationRun.create({ data: { mode } });

  const candidates = await selectConsolidationCandidates(options.limit);
  const clusters = clusterEpisodes(candidates);
  let generated = 0;

  for (const cluster of clusters) {
    const content = describeCluster(cluster);
    const confidence = generalizationConfidence(cluster.experienceIds.length);

    // One generalization per (agent, domain, direction) — re-running a cycle
    // strengthens the existing belief with new episodes rather than creating a
    // second copy of it.
    // Match an existing belief by agent, direction and wording overlap rather
    // than an exact tag: the cluster's label is derived from whichever episodes
    // happened to be in this cycle, so it is not stable across runs.
    const direction = cluster.succeeded ? "strength" : "weakness";
    const clusterTokens = new Set(cluster.domain.split("-"));
    const siblings = await db.memory.findMany({
      where: {
        provenanceClass: "GENERALIZED", type: "agent_capability",
        owner: cluster.agentId, tags: { has: direction }, validTo: null,
      },
    });
    const existing = siblings.find(
      (candidate) => tokenSimilarity(new Set(candidate.tags.filter((t) => t !== direction)), clusterTokens) >= SIMILARITY_THRESHOLD,
    );

    if (existing) {
      const mergedEpisodes = [...new Set([...existing.derivedFromExperienceIds, ...cluster.experienceIds])];
      await db.memory.update({
        where: { id: existing.id },
        data: {
          content,
          derivedFromExperienceIds: mergedEpisodes,
          tags: [...new Set([...existing.tags, ...cluster.domain.split("-")])],
          confidence: generalizationConfidence(mergedEpisodes.length),
        },
      });
    } else {
      await db.memory.create({
        data: {
          type: "agent_capability",
          scope: "global",
          owner: cluster.agentId,
          content,
          source: "consolidation",
          provenanceClass: "GENERALIZED",
          provenanceTrust: provenanceTrustFor("GENERALIZED"),
          // Shadow: generated, scored and linked, but excluded from every
          // production retrieval branch until explicitly promoted.
          shadowOnly: mode === "shadow",
          confidence,
          importanceScore: 0.5,
          tags: [...cluster.domain.split("-"), direction],
          derivedFromExperienceIds: cluster.experienceIds,
          state: "candidate",
        },
      });
      generated += 1;
    }
  }

  const consolidatedIds = clusters.flatMap((c) => c.experienceIds);
  if (consolidatedIds.length) {
    await db.experience.updateMany({
      where: { id: { in: consolidatedIds } },
      data: { consolidationState: "consolidated", consolidatedAt: new Date() },
    });
  }
  // Everything examined but not clustered stays episodic — explicitly marked so
  // a later cycle does not re-examine it forever.
  const unclustered = candidates.map((c) => c.experienceId).filter((id) => !consolidatedIds.includes(id));
  if (unclustered.length) {
    await db.experience.updateMany({ where: { id: { in: unclustered } }, data: { consolidationState: "skipped" } });
  }

  // How many episodes one abstraction now stands in for.
  const compressionRatio = generated > 0 ? consolidatedIds.length / generated : null;

  await db.consolidationRun.update({
    where: { id: run.id },
    data: {
      completedAt: new Date(),
      experiencesScanned: candidates.length,
      candidatesFound: clusters.length,
      memoriesGenerated: generated,
      compressionRatio,
      notes: { clusters: clusters.map((c) => ({ agentId: c.agentId, domain: c.domain, episodes: c.experienceIds.length })) },
    },
  });

  for (const id of candidates.map((c) => c.experienceId)) {
    await db.experience.update({ where: { id }, data: { predictionError: candidates.find((c) => c.experienceId === id)?.predictionError } }).catch(() => null);
  }

  return {
    runId: run.id,
    mode,
    experiencesScanned: candidates.length,
    candidatesFound: clusters.length,
    memoriesGenerated: generated,
    compressionRatio,
  };
}
