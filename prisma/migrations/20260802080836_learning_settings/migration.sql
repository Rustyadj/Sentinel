-- CreateTable
CREATE TABLE "learning_settings" (
    "id" TEXT NOT NULL,
    "scopeType" TEXT NOT NULL,
    "scopeId" TEXT NOT NULL,
    "curiosityThreshold" DOUBLE PRECISION,
    "minShadowSampleSize" INTEGER,
    "benchmarkThresholds" JSONB,
    "trustThresholds" JSONB,
    "rolloutSteps" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "dailyLearningBudgetUsd" DOUBLE PRECISION,
    "perAgentBudgetUsd" DOUBLE PRECISION,
    "replayLimits" JSONB,
    "modelAllowlist" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxSandboxConcurrency" INTEGER,
    "autoDeployEnabled" BOOLEAN NOT NULL DEFAULT false,
    "updatedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_settings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "learning_settings_scopeType_scopeId_key" ON "learning_settings"("scopeType", "scopeId");
