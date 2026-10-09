-- One-use bot tool approvals, made durable. Consumption used to live in the
-- executor's memory only, and an approval continuation copied the original
-- request's approvedTools, so approving A, using A, then approving B granted A
-- again. A grant is now a row: spent by a conditional update, and a continuation
-- inherits only its parent's unspent rows. Additive; no existing row changes.
CREATE TABLE "bot_tool_grants" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "approvalRequestId" TEXT,
    "sourceRunId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumedAt" TIMESTAMP(3),

    CONSTRAINT "bot_tool_grants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_tool_grants_runId_key_key" ON "bot_tool_grants"("runId", "key");

CREATE INDEX "bot_tool_grants_runId_consumedAt_idx" ON "bot_tool_grants"("runId", "consumedAt");

ALTER TABLE "bot_tool_grants" ADD CONSTRAINT "bot_tool_grants_runId_fkey" FOREIGN KEY ("runId") REFERENCES "orchestration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
