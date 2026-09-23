-- Per-session telemetry for live voice conversations.
--
-- Purely additive: one new table, no changes to existing tables or data.

CREATE TABLE "voice_session_telemetry" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "roomId" TEXT,
    "voiceModel" TEXT NOT NULL,
    "reasoningModel" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),
    "liveSeconds" INTEGER NOT NULL DEFAULT 0,
    "reasoningInputTokens" INTEGER NOT NULL DEFAULT 0,
    "reasoningOutputTokens" INTEGER NOT NULL DEFAULT 0,
    "toolCallCount" INTEGER NOT NULL DEFAULT 0,
    "latencyMsTotal" INTEGER NOT NULL DEFAULT 0,
    "latencySamples" INTEGER NOT NULL DEFAULT 0,
    "latencyMsMax" INTEGER NOT NULL DEFAULT 0,
    "estimatedCostUsd" DOUBLE PRECISION,

    CONSTRAINT "voice_session_telemetry_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "voice_session_telemetry_userId_idx" ON "voice_session_telemetry"("userId");
CREATE INDEX "voice_session_telemetry_agentId_idx" ON "voice_session_telemetry"("agentId");
CREATE INDEX "voice_session_telemetry_roomId_idx" ON "voice_session_telemetry"("roomId");
