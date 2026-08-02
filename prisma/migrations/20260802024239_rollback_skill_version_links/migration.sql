-- AlterTable
ALTER TABLE "learning_feature_flags" ADD COLUMN     "learningCandidateId" TEXT;

-- AlterTable
ALTER TABLE "learning_skill_versions" ADD COLUMN     "retiredAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "learning_feature_flags_learningCandidateId_idx" ON "learning_feature_flags"("learningCandidateId");

-- AddForeignKey
ALTER TABLE "learning_feature_flags" ADD CONSTRAINT "learning_feature_flags_learningCandidateId_fkey" FOREIGN KEY ("learningCandidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;
