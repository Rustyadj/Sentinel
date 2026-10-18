-- AlterTable
ALTER TABLE "workflows" ADD COLUMN     "botId" TEXT,
ADD COLUMN     "intervalMinutes" INTEGER,
ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'graph',
ADD COLUMN     "nextRunAt" TIMESTAMP(3),
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "reviewedDigest" TEXT,
ADD COLUMN     "revision" INTEGER NOT NULL DEFAULT 1,
ADD COLUMN     "routineContext" TEXT,
ADD COLUMN     "routineTask" TEXT,
ADD COLUMN     "runAsUserId" TEXT,
ADD COLUMN     "skillVersionId" TEXT,
ADD COLUMN     "workspaceId" TEXT;

-- CreateTable
CREATE TABLE "routine_runs" (
    "id" TEXT NOT NULL,
    "workflowId" TEXT NOT NULL,
    "revision" INTEGER NOT NULL,
    "skillVersionId" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "requestKey" TEXT NOT NULL,
    "taskId" TEXT,
    "currentTaskId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "input" JSONB NOT NULL,
    "scheduledFor" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "resultSummary" TEXT,
    "errorSummary" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "routine_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "routine_runs_taskId_key" ON "routine_runs"("taskId");

-- CreateIndex
CREATE INDEX "routine_runs_workflowId_createdAt_idx" ON "routine_runs"("workflowId", "createdAt");

-- CreateIndex
CREATE INDEX "routine_runs_status_createdAt_idx" ON "routine_runs"("status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "routine_runs_workflowId_requestKey_key" ON "routine_runs"("workflowId", "requestKey");

-- CreateIndex
CREATE INDEX "workflows_kind_status_nextRunAt_idx" ON "workflows"("kind", "status", "nextRunAt");

-- CreateIndex
CREATE INDEX "workflows_workspaceId_botId_idx" ON "workflows"("workspaceId", "botId");

-- AddForeignKey
ALTER TABLE "workflows" ADD CONSTRAINT "workflows_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "learning_skill_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_workflowId_fkey" FOREIGN KEY ("workflowId") REFERENCES "workflows"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "routine_runs" ADD CONSTRAINT "routine_runs_skillVersionId_fkey" FOREIGN KEY ("skillVersionId") REFERENCES "learning_skill_versions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- A waiting approval or unconfirmed cancellation still owns the routine slot.
CREATE UNIQUE INDEX "routine_runs_one_in_flight" ON "routine_runs" ("workflowId")
WHERE "status" IN ('pending', 'queued', 'running', 'waiting', 'cancelling');

-- Defence in depth for the governed task admission idempotency namespace.
-- Restricted to the new namespace so existing task keys need no deduplication.
CREATE UNIQUE INDEX "orchestration_runs_routine_idempotency" ON "orchestration_runs" ("botId", "originKey", "idempotencyKey")
WHERE "idempotencyKey" LIKE 'routine-%';

-- Learning versions of other implementation types retain their existing lifecycle.
-- A reviewed Hermes checkpoint's content and review evidence cannot be rewritten.
CREATE FUNCTION protect_routine_skill_snapshot() RETURNS trigger AS $$
BEGIN
  IF OLD."implementationType" = 'hermes-routine-snapshot' AND
     (NEW."implementation" IS DISTINCT FROM OLD."implementation" OR
      NEW."implementationType" IS DISTINCT FROM OLD."implementationType" OR
      NEW."skillId" IS DISTINCT FROM OLD."skillId" OR NEW."version" IS DISTINCT FROM OLD."version") THEN
    RAISE EXCEPTION 'Reviewed routine skill snapshots are immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "routine_skill_snapshot_immutable" BEFORE UPDATE ON "learning_skill_versions"
FOR EACH ROW EXECUTE FUNCTION protect_routine_skill_snapshot();

-- The executor may also include a bot's assigned skill text. Freeze the source
-- of a checkpoint too, so assigning that skill cannot inject edited instructions
-- alongside a routine's pinned task. Revocation (status) remains available.
CREATE FUNCTION protect_checkpointed_hermes_skill() RETURNS trigger AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM "learning_skill_versions" v
             WHERE v."skillId" = OLD."id" AND v."implementationType" = 'hermes-routine-snapshot') AND
     (NEW."body" IS DISTINCT FROM OLD."body" OR NEW."name" IS DISTINCT FROM OLD."name" OR
      NEW."requiredTools" IS DISTINCT FROM OLD."requiredTools" OR NEW."source" IS DISTINCT FROM OLD."source" OR
      NEW."version" IS DISTINCT FROM OLD."version" OR NEW."format" IS DISTINCT FROM OLD."format" OR
      NEW."workspaceId" IS DISTINCT FROM OLD."workspaceId" OR
      (NEW."status" = 'active' AND (NEW."reviewedAt" IS DISTINCT FROM OLD."reviewedAt" OR NEW."reviewedByUserId" IS DISTINCT FROM OLD."reviewedByUserId"))) THEN
    RAISE EXCEPTION 'Checkpointed Hermes skill content is immutable; propose and review a new skill';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER "checkpointed_hermes_skill_immutable" BEFORE UPDATE ON "neural_skills"
FOR EACH ROW EXECUTE FUNCTION protect_checkpointed_hermes_skill();
