-- System 1 decision telemetry (ADR-004).
--
-- Purely additive: one new table, no changes to existing tables or data.

CREATE TABLE "system_one_decisions" (
    "id" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "surface" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roomId" TEXT,
    "mode" TEXT NOT NULL,
    "outcome" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "providerModel" TEXT,
    "s1LatencyMs" INTEGER,
    "s1InputTokens" INTEGER NOT NULL DEFAULT 0,
    "s1CostUsd" DOUBLE PRECISION,
    "intent" TEXT,
    "route" TEXT,
    "confidence" DOUBLE PRECISION,
    "decision" JSONB,
    "plannedAction" TEXT,
    "planReasons" JSONB,
    "executedPath" TEXT NOT NULL,
    "system2Invoked" BOOLEAN NOT NULL,
    "system2Avoided" BOOLEAN NOT NULL DEFAULT false,
    "memorySkipped" BOOLEAN NOT NULL DEFAULT false,
    "toolId" TEXT,
    "toolOk" BOOLEAN,
    "toolLatencyMs" INTEGER,
    "system2Model" TEXT,
    "system2InputTokens" INTEGER,
    "system2OutputTokens" INTEGER,
    "system2Tools" JSONB,
    "estTokensAvoided" INTEGER,
    "estCostAvoidedUsd" DOUBLE PRECISION,
    "totalLatencyMs" INTEGER,
    "phases" JSONB NOT NULL,
    "interrupted" BOOLEAN NOT NULL DEFAULT false,
    "ttfaMs" INTEGER,

    CONSTRAINT "system_one_decisions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "system_one_decisions_createdAt_idx" ON "system_one_decisions"("createdAt");
CREATE INDEX "system_one_decisions_agentId_createdAt_idx" ON "system_one_decisions"("agentId", "createdAt");
