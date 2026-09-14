-- Continual memory, stage 1: make the net-value signal pipeline real.
--
-- computeMemoryNetValue already weighed nine inputs, but seven were never
-- written by any code path, so decay collapsed to age-since-last-row-write.
-- This adds the columns and the join table those signals need. Additive only:
-- no DROP, no TRUNCATE, no DELETE, no column retype.

ALTER TABLE "memories" ADD COLUMN "provenanceClass" TEXT NOT NULL DEFAULT 'OBSERVED';
ALTER TABLE "memories" ADD COLUMN "lastRetrievedAt" TIMESTAMP(3);
ALTER TABLE "memories" ADD COLUMN "retrievalCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "memories" ADD COLUMN "disconfirmationCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "memories" ADD COLUMN "shadowOnly" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "memories" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "memories" ADD COLUMN "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
ALTER TABLE "memories" ADD COLUMN "validTo" TIMESTAMP(3);
ALTER TABLE "memories" ADD COLUMN "supersededById" TEXT;
ALTER TABLE "memories" ADD COLUMN "changeReason" TEXT;

-- Existing rows predate derived memory entirely, so they are first-hand
-- captures. Classify from the free-text `source` already recorded rather than
-- assuming: guessing INFERRED here would silently downgrade real history.
UPDATE "memories" SET "provenanceClass" = 'USER_PROVIDED'
  WHERE lower(coalesce("source", '')) LIKE '%user%'
     OR lower(coalesce("source", '')) LIKE '%preference%'
     OR lower(coalesce("source", '')) LIKE '%manual%';

CREATE INDEX "memories_provenanceClass_idx" ON "memories"("provenanceClass");
CREATE INDEX "memories_shadowOnly_idx" ON "memories"("shadowOnly");
CREATE INDEX "memories_validTo_idx" ON "memories"("validTo");

CREATE TABLE "memory_retrievals" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "experienceId" TEXT,
    "runId" TEXT,
    "userId" TEXT,
    "projectId" TEXT,
    "workspaceId" TEXT,
    "retrievedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "outcomeStatus" TEXT,
    "outcomeScore" DOUBLE PRECISION,
    "contributedToOutcome" BOOLEAN,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "memory_retrievals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "memory_retrievals_memoryId_idx" ON "memory_retrievals"("memoryId");
CREATE INDEX "memory_retrievals_experienceId_idx" ON "memory_retrievals"("experienceId");
CREATE INDEX "memory_retrievals_resolvedAt_idx" ON "memory_retrievals"("resolvedAt");

ALTER TABLE "memory_retrievals" ADD CONSTRAINT "memory_retrievals_memoryId_fkey"
  FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
