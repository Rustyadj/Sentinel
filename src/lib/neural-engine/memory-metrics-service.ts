// Sentinel — memory metrics.
//
// The programme's stated goal is *less* context, not more, and without
// measurement that claim is unfalsifiable: a confident wrong abstraction looks
// exactly like a good one. Everything here is computed from data the system now
// records as a side effect of doing its work — no separate telemetry path, no
// estimates standing in for facts.

import { db } from "@/lib/db";

/**
 * Token estimate for retrieved text.
 *
 * Deliberately a cheap approximation (~4 chars/token) rather than a real
 * tokenizer: this measures relative change between retrieval strategies, and
 * pulling a tokenizer onto the retrieval path would cost more than the signal
 * is worth. Reported as an estimate everywhere so it is never mistaken for
 * billing truth.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

export interface RetrievalFootprint {
  items: number;
  estimatedTokens: number;
  duplicateItems: number;
  duplicateTokens: number;
}

/**
 * What a retrieval actually costs, and how much of it is redundant.
 *
 * Duplicate detection is by normalized content: near-identical episodes are the
 * exact redundancy consolidation is supposed to remove, so measuring it is how
 * we tell whether consolidation is earning its place.
 */
export function retrievalFootprint(items: Array<{ content: string }>): RetrievalFootprint {
  const seen = new Set<string>();
  let duplicateItems = 0;
  let duplicateTokens = 0;
  let estimatedTokens = 0;

  for (const item of items) {
    const tokens = estimateTokens(item.content);
    estimatedTokens += tokens;
    const normalized = item.content.trim().toLowerCase().replace(/\s+/g, " ");
    if (seen.has(normalized)) {
      duplicateItems += 1;
      duplicateTokens += tokens;
    } else {
      seen.add(normalized);
    }
  }

  return { items: items.length, estimatedTokens, duplicateItems, duplicateTokens };
}

export interface UsefulnessMetrics {
  resolvedRetrievals: number;
  contributedToSuccess: number;
  usefulRetrievalRate: number | null;
  unresolvedRetrievals: number;
}

/**
 * How often retrieved memory was present for work that succeeded.
 *
 * Returns null for the rate when nothing has been resolved yet, so an
 * unmeasured system reads as unmeasured rather than as a failing one.
 */
export async function usefulRetrievalRate(since?: Date): Promise<UsefulnessMetrics> {
  const where = since ? { retrievedAt: { gte: since } } : {};
  const [resolved, contributed, unresolved] = await Promise.all([
    db.memoryRetrieval.count({ where: { ...where, resolvedAt: { not: null } } }),
    db.memoryRetrieval.count({ where: { ...where, contributedToOutcome: true } }),
    db.memoryRetrieval.count({ where: { ...where, resolvedAt: null } }),
  ]);

  return {
    resolvedRetrievals: resolved,
    contributedToSuccess: contributed,
    usefulRetrievalRate: resolved > 0 ? contributed / resolved : null,
    unresolvedRetrievals: unresolved,
  };
}

export interface CompressionMetrics {
  runs: number;
  episodesConsolidated: number;
  memoriesGenerated: number;
  /** Episodes now standing behind each abstraction. Higher is more compression. */
  compressionRatio: number | null;
}

/** How many episodes each generated abstraction stands in for. */
export async function consolidationCompression(): Promise<CompressionMetrics> {
  const runs = await db.consolidationRun.findMany({
    where: { completedAt: { not: null } },
    select: { experiencesScanned: true, memoriesGenerated: true },
  });

  const memoriesGenerated = runs.reduce((sum, run) => sum + run.memoriesGenerated, 0);
  const episodesConsolidated = runs.reduce((sum, run) => sum + run.experiencesScanned, 0);

  return {
    runs: runs.length,
    episodesConsolidated,
    memoriesGenerated,
    compressionRatio: memoriesGenerated > 0 ? episodesConsolidated / memoriesGenerated : null,
  };
}

export interface MemoryStorageMetrics {
  total: number;
  byProvenance: Record<string, number>;
  shadowOnly: number;
  superseded: number;
  forgotten: number;
}

/** Storage growth, split by how each memory came to exist. */
export async function memoryStorageMetrics(): Promise<MemoryStorageMetrics> {
  const [grouped, total, shadowOnly, superseded, forgotten] = await Promise.all([
    db.memory.groupBy({ by: ["provenanceClass"], _count: { _all: true } }),
    db.memory.count(),
    db.memory.count({ where: { shadowOnly: true } }),
    db.memory.count({ where: { validTo: { not: null } } }),
    db.memory.count({ where: { state: "forgotten" } }),
  ]);

  return {
    total,
    byProvenance: Object.fromEntries(grouped.map((row) => [row.provenanceClass, row._count._all])),
    shadowOnly,
    superseded,
    forgotten,
  };
}

export interface MemoryHealthReport {
  usefulness: UsefulnessMetrics;
  compression: CompressionMetrics;
  storage: MemoryStorageMetrics;
}

export async function memoryHealthReport(since?: Date): Promise<MemoryHealthReport> {
  const [usefulness, compression, storage] = await Promise.all([
    usefulRetrievalRate(since),
    consolidationCompression(),
    memoryStorageMetrics(),
  ]);
  return { usefulness, compression, storage };
}
