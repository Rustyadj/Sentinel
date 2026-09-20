// Sentinel — reading and writing memory embeddings with their provenance.
//
// Prisma cannot type pgvector columns (they are `Unsupported`), so writes and
// vector reads go through parameterised raw SQL. Values are always bound, never
// interpolated; the only interpolated token is the column name, which is
// derived from a closed set of supported dimensions rather than from input.

import { db } from "@/lib/db";
import { logger } from "@/lib/logger";
import { embed, getEmbeddingProvider, vectorColumnFor, type EmbeddingProvider } from "./embeddings";

export interface EmbeddingProvenance {
  provider: string;
  model: string;
  dimensions: number;
  version: number;
}

/** pgvector's text input format. */
function toVectorLiteral(vector: number[]): string {
  return `[${vector.join(",")}]`;
}

export interface StoreEmbeddingInput extends EmbeddingProvenance {
  memoryId: string;
  vector: number[];
  embedMs?: number;
}

/**
 * Write one embedding, replacing any previous vector for the same
 * (memory, provider, model, version).
 *
 * Re-running the same model over the same memory is an update. Running a
 * *different* model, or bumping the version, is a new row — the old vector is
 * kept so a provider comparison has something to compare against and a
 * cut-over has something to roll back to.
 */
export async function storeEmbedding(input: StoreEmbeddingInput): Promise<void> {
  if (input.vector.length !== input.dimensions) {
    throw new Error(
      `Refusing to store a ${input.vector.length}-dimensional vector as ${input.dimensions} dimensions ` +
        `for memory ${input.memoryId}.`,
    );
  }
  const column = vectorColumnFor(input.dimensions); // throws on anything unsupported

  await db.$executeRawUnsafe(
    `INSERT INTO "memory_embeddings"
       ("id", "memoryId", "provider", "model", "dimensions", "version", "${column}", "embedMs", "createdAt")
     VALUES (gen_random_uuid()::text, $1, $2, $3, $4, $5, $6::vector, $7, CURRENT_TIMESTAMP)
     ON CONFLICT ("memoryId", "provider", "model", "version")
     DO UPDATE SET "${column}" = EXCLUDED."${column}",
                   "embedMs"   = EXCLUDED."embedMs",
                   "createdAt" = CURRENT_TIMESTAMP`,
    input.memoryId,
    input.provider,
    input.model,
    input.dimensions,
    input.version,
    toVectorLiteral(input.vector),
    input.embedMs ?? null,
  );
}

export interface SimilarMemory {
  memoryId: string;
  distance: number;
}

/**
 * Nearest neighbours within one embedding space.
 *
 * The provenance filter is not optional and not a convenience: vectors from
 * different models occupy different spaces, and comparing across them produces
 * a number that looks like a distance and means nothing.
 *
 * `candidateMemoryIds` is how scope survives. This function does not know what
 * the caller may see, so it only ever ranks ids the caller has already
 * filtered through buildRetrievalFilters.
 */
export async function findSimilar(
  queryVector: number[],
  provenance: EmbeddingProvenance,
  candidateMemoryIds: string[],
  limit: number,
): Promise<SimilarMemory[]> {
  if (candidateMemoryIds.length === 0) return [];
  const column = vectorColumnFor(provenance.dimensions);

  const rows = await db.$queryRawUnsafe<Array<{ memoryId: string; distance: number }>>(
    `SELECT "memoryId", ("${column}" <=> $1::vector) AS distance
       FROM "memory_embeddings"
      WHERE "provider" = $2 AND "model" = $3 AND "version" = $4
        AND "memoryId" = ANY($5::text[])
        AND "${column}" IS NOT NULL
      ORDER BY distance ASC
      LIMIT $6`,
    toVectorLiteral(queryVector),
    provenance.provider,
    provenance.model,
    provenance.version,
    candidateMemoryIds,
    limit,
  );
  return rows.map((row) => ({ memoryId: row.memoryId, distance: Number(row.distance) }));
}

export function provenanceOf(provider: EmbeddingProvider, version = 1): EmbeddingProvenance {
  return { provider: provider.name, model: provider.model, dimensions: provider.dimensions, version };
}

/**
 * Embed texts and store them, returning how many were written.
 *
 * Self-guarding like `embed()`: with no provider, or an unreachable one, it
 * writes nothing and reports zero rather than throwing. Memory ingestion must
 * not fail because an embedding API is down.
 */
export async function embedAndStore(
  items: Array<{ memoryId: string; text: string }>,
  version = 1,
): Promise<{ stored: number; provenance: EmbeddingProvenance | null; embedMs: number }> {
  const provider = getEmbeddingProvider();
  if (!provider || items.length === 0) return { stored: 0, provenance: null, embedMs: 0 };

  const startedAt = performance.now();
  const result = await embed(items.map((item) => item.text));
  const embedMs = Math.round(performance.now() - startedAt);
  if (!result) return { stored: 0, provenance: null, embedMs };

  const provenance = provenanceOf(provider, version);
  const perItemMs = Math.round(embedMs / Math.max(1, items.length));

  let stored = 0;
  for (const [index, item] of items.entries()) {
    const vector = result.vectors[index];
    if (!vector) continue;
    try {
      await storeEmbedding({ ...provenance, memoryId: item.memoryId, vector, embedMs: perItemMs });
      stored += 1;
    } catch (error) {
      logger.warn("embeddings: failed to store a vector", { memoryId: item.memoryId, error: String(error) });
    }
  }
  return { stored, provenance, embedMs };
}
