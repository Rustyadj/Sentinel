-- AlterTable
ALTER TABLE "learning_experiments" ADD COLUMN     "approvalLevel" INTEGER NOT NULL DEFAULT 2;

-- AlterTable
ALTER TABLE "learning_hypotheses" ADD COLUMN     "approvalLevel" INTEGER NOT NULL DEFAULT 2;
