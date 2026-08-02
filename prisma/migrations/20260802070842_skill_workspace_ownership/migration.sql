-- AlterTable
ALTER TABLE "neural_skills" ADD COLUMN     "workspaceId" TEXT;

-- CreateIndex
CREATE INDEX "neural_skills_workspaceId_idx" ON "neural_skills"("workspaceId");
