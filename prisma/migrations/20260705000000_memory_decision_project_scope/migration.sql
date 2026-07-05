-- Add projectId to Memory and Decision for real project-scope isolation
ALTER TABLE "memories" ADD COLUMN "projectId" TEXT;
CREATE INDEX "memories_projectId_idx" ON "memories"("projectId");

ALTER TABLE "decisions" ADD COLUMN "projectId" TEXT;
CREATE INDEX "decisions_projectId_idx" ON "decisions"("projectId");
