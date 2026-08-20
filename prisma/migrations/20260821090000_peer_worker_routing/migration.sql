-- AlterTable
ALTER TABLE "agents" ADD COLUMN     "capabilityWeights" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "tasks" ADD COLUMN     "baseBranch" TEXT,
ADD COLUMN     "branch" TEXT,
ADD COLUMN     "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "fileScope" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN     "worktreePath" TEXT;

-- Default capability weights for the four VPS runtime registry agents
-- seeded in 20260820063000_collaboration_room. These are routing hints
-- src/lib/orchestration/capabilities.ts falls back to identical defaults
-- when this column is still "{}", so this seed is redundant with that
-- fallback by design (an operator can edit these rows directly later
-- without touching code) rather than a hard requirement for routing to
-- work correctly.
UPDATE "agents" SET "capabilityWeights" = '{
  "coding": 0.95, "architecture": 0.9, "frontend": 0.9, "backend": 0.95,
  "refactoring": 0.95, "debugging": 0.85, "testing": 0.85, "security": 0.8,
  "database": 0.85, "devops": 0.75, "research": 0.8
}'::jsonb WHERE "id" = 'claude-code' AND "capabilityWeights" = '{}'::jsonb;

UPDATE "agents" SET "capabilityWeights" = '{
  "coding": 0.95, "testing": 0.95, "debugging": 0.95, "backend": 0.9,
  "frontend": 0.9, "architecture": 0.8, "refactoring": 0.85, "security": 0.85,
  "database": 0.85, "devops": 0.8, "research": 0.75
}'::jsonb WHERE "id" = 'codex' AND "capabilityWeights" = '{}'::jsonb;

UPDATE "agents" SET "capabilityWeights" = '{
  "research": 0.9, "architecture": 0.85
}'::jsonb WHERE "id" = 'hermes-lisa' AND "capabilityWeights" = '{}'::jsonb;

UPDATE "agents" SET "capabilityWeights" = '{
  "research": 0.85
}'::jsonb WHERE "id" = 'openclaw' AND "capabilityWeights" = '{}'::jsonb;
