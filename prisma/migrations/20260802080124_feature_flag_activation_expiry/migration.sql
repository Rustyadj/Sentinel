-- AlterTable
ALTER TABLE "learning_feature_flags" ADD COLUMN     "activatedAt" TIMESTAMP(3),
ADD COLUMN     "expiresAt" TIMESTAMP(3);

-- Defense in depth: app-level validation (validateRollout/validateRiskTier
-- in feature-flags.ts) already rejects out-of-range values, but PR #21's
-- audit specifically flagged that nothing enforced this at the database
-- layer — a direct write outside the service could still violate it.
ALTER TABLE "learning_feature_flags"
  ADD CONSTRAINT "learning_feature_flags_rolloutPercentage_range"
  CHECK ("rolloutPercentage" >= 0 AND "rolloutPercentage" <= 100);

ALTER TABLE "learning_feature_flags"
  ADD CONSTRAINT "learning_feature_flags_riskTier_values"
  CHECK ("riskTier" IN ('low', 'medium', 'high'));
