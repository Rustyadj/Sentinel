-- Single-use, action-bound approvals (src/lib/orchestration/approval-binding.ts).
-- Additive only. Hand-trimmed from `prisma migrate diff`: the generated diff also
-- carries the schema drift already on main (destructive column and default changes
-- to other tables), none of which belongs to this change.

-- AlterTable
ALTER TABLE "approval_requests" ADD COLUMN     "actionFingerprint" TEXT,
ADD COLUMN     "consumedAt" TIMESTAMP(3),
ADD COLUMN     "consumedByRunId" TEXT;

-- CreateIndex
CREATE INDEX "approval_requests_taskId_actionFingerprint_idx" ON "approval_requests"("taskId", "actionFingerprint");
