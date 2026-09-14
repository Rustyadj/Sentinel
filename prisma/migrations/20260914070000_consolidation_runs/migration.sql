-- Continual memory, stage 3: bounded, restartable shadow consolidation cycles.
-- Additive only.
ALTER TABLE "neural_experiences" ADD COLUMN "predictionError" DOUBLE PRECISION;
ALTER TABLE "neural_experiences" ADD COLUMN "consolidationState" TEXT NOT NULL DEFAULT 'pending';
ALTER TABLE "neural_experiences" ADD COLUMN "consolidatedAt" TIMESTAMP(3);

CREATE TABLE "memory_consolidation_runs" (
    "id" TEXT NOT NULL,
    "mode" TEXT NOT NULL DEFAULT 'shadow',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "experiencesScanned" INTEGER NOT NULL DEFAULT 0,
    "candidatesFound" INTEGER NOT NULL DEFAULT 0,
    "memoriesGenerated" INTEGER NOT NULL DEFAULT 0,
    "memoriesStrengthened" INTEGER NOT NULL DEFAULT 0,
    "compressionRatio" DOUBLE PRECISION,
    "notes" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "memory_consolidation_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "memory_consolidation_runs_mode_startedAt_idx" ON "memory_consolidation_runs"("mode", "startedAt");
