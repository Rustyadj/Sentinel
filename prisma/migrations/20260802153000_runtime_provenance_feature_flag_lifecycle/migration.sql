-- Persist assistant-response provenance so runtime-produced messages remain
-- attributable after a stream or browser session ends.
ALTER TABLE "messages"
  ADD COLUMN "runtimeKind" TEXT,
  ADD COLUMN "provider" TEXT,
  ADD COLUMN "model" TEXT,
  ADD COLUMN "agentRuntimeSessionId" TEXT;

CREATE INDEX "messages_agentRuntimeSessionId_idx"
  ON "messages"("agentRuntimeSessionId");

ALTER TABLE "messages"
  ADD CONSTRAINT "messages_agentRuntimeSessionId_fkey"
  FOREIGN KEY ("agentRuntimeSessionId") REFERENCES "agent_sessions"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

-- Add explicit progressive-rollout controls. monitoringWindow is stored in
-- seconds so operators and future workers share one unambiguous unit.
ALTER TABLE "learning_feature_flags"
  ADD COLUMN "rolloutStep" INTEGER NOT NULL DEFAULT 10,
  ADD COLUMN "maxRollout" INTEGER NOT NULL DEFAULT 100,
  ADD COLUMN "rollbackThresholds" JSONB NOT NULL DEFAULT '{}',
  ADD COLUMN "monitoringWindow" INTEGER NOT NULL DEFAULT 3600,
  ADD COLUMN "lastEvaluatedAt" TIMESTAMP(3);

ALTER TABLE "learning_feature_flags"
  ADD CONSTRAINT "learning_feature_flags_rolloutStep_range"
  CHECK ("rolloutStep" >= 0 AND "rolloutStep" <= 100),
  ADD CONSTRAINT "learning_feature_flags_maxRollout_range"
  CHECK ("maxRollout" >= 0 AND "maxRollout" <= 100),
  ADD CONSTRAINT "learning_feature_flags_rollout_within_max"
  CHECK ("rolloutPercentage" <= "maxRollout"),
  ADD CONSTRAINT "learning_feature_flags_monitoringWindow_positive"
  CHECK ("monitoringWindow" > 0),
  ADD CONSTRAINT "learning_feature_flags_activation_before_expiry"
  CHECK ("activatedAt" IS NULL OR "expiresAt" IS NULL OR "activatedAt" < "expiresAt");
