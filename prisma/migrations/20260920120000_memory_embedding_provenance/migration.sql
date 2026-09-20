-- Memory embeddings with provenance, one row per (memory, provider, model, version).
--
-- Additive and non-destructive: memories.embedding is left exactly as it is.
-- Nothing has ever written to it (there is no index on it either), so there
-- are no vectors to migrate; it is kept rather than dropped so that rollback
-- to the previous shape needs no migration of its own.
--
-- Exactly one vector column per row is non-null, selected by "dimensions".
-- pgvector fixes dimensionality in the column type, so a single column would
-- have continued to decide which providers are usable -- which is how a
-- vector(1536) column came to rule out voyage-3-lite (512) and voyage-3 (1024).

CREATE TABLE IF NOT EXISTS "memory_embeddings" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "dimensions" INTEGER NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "vector512" vector(512),
    "vector1024" vector(1024),
    "vector1536" vector(1536),
    "vector3072" vector(3072),
    "embedMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "memory_embeddings_pkey" PRIMARY KEY ("id")
);

-- The stored vector must match the declared dimensionality, and there must be
-- exactly one. Enforced here rather than in application code because a wrong
-- vector in the wrong column yields a plausible-looking distance rather than
-- an error, and a silently wrong distance is the hardest kind of bug to find.
ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_one_vector_matching_dimensions"
CHECK (
  (("vector512" IS NOT NULL)::int + ("vector1024" IS NOT NULL)::int
   + ("vector1536" IS NOT NULL)::int + ("vector3072" IS NOT NULL)::int) = 1
  AND CASE "dimensions"
        WHEN 512  THEN "vector512"  IS NOT NULL
        WHEN 1024 THEN "vector1024" IS NOT NULL
        WHEN 1536 THEN "vector1536" IS NOT NULL
        WHEN 3072 THEN "vector3072" IS NOT NULL
        ELSE false
      END
);

CREATE UNIQUE INDEX IF NOT EXISTS "memory_embeddings_memoryId_provider_model_version_key"
  ON "memory_embeddings"("memoryId", "provider", "model", "version");

CREATE INDEX IF NOT EXISTS "memory_embeddings_provider_model_version_idx"
  ON "memory_embeddings"("provider", "model", "version");

CREATE INDEX IF NOT EXISTS "memory_embeddings_memoryId_idx"
  ON "memory_embeddings"("memoryId");

ALTER TABLE "memory_embeddings" ADD CONSTRAINT "memory_embeddings_memoryId_fkey"
  FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- ANN indexes are deliberately NOT created here. ivfflat needs representative
-- data to build meaningful lists and pgvector will not index beyond 2000
-- dimensions at all, so the index belongs in a follow-up migration once a
-- provider has been chosen by benchmark and a corpus exists. Exact scan is
-- correct, just slower, and correctness first is the point of this table.
