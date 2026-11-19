-- CreateTable
CREATE TABLE "objectives" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "goal" TEXT NOT NULL,
    "templateKey" TEXT NOT NULL,
    "autonomyLevel" INTEGER NOT NULL DEFAULT 2,
    "status" TEXT NOT NULL DEFAULT 'running',
    "inputs" JSONB NOT NULL DEFAULT '{}',
    "budgetCents" INTEGER NOT NULL DEFAULT 0,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "report" JSONB NOT NULL DEFAULT '{}',
    "leaseOwner" TEXT,
    "leaseExpiresAt" TIMESTAMP(3),
    "stopReason" TEXT,
    "stoppedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "objectives_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective_steps" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "role" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "toolKey" TEXT NOT NULL,
    "input" JSONB NOT NULL DEFAULT '{}',
    "dependsOn" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'pending',
    "impact" TEXT NOT NULL DEFAULT 'read',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "maxAttempts" INTEGER NOT NULL DEFAULT 3,
    "nextAttemptAt" TIMESTAMP(3),
    "idempotencyKey" TEXT NOT NULL,
    "output" JSONB NOT NULL DEFAULT '{}',
    "verification" JSONB NOT NULL DEFAULT '{}',
    "blockedReason" TEXT,
    "unblockRequest" TEXT,
    "error" TEXT,
    "approvalRequestId" TEXT,
    "approvalClearedAt" TIMESTAMP(3),
    "orchestrationRunId" TEXT,
    "estimatedCostCents" INTEGER NOT NULL DEFAULT 0,
    "actualCostCents" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "objective_steps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "objective_events" (
    "id" TEXT NOT NULL,
    "objectiveId" TEXT NOT NULL,
    "stepKey" TEXT,
    "type" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "objective_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "objectives_workspaceId_createdAt_idx" ON "objectives"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "objectives_status_leaseExpiresAt_idx" ON "objectives"("status", "leaseExpiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "objective_steps_idempotencyKey_key" ON "objective_steps"("idempotencyKey");

-- CreateIndex
CREATE INDEX "objective_steps_objectiveId_status_idx" ON "objective_steps"("objectiveId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "objective_steps_objectiveId_key_key" ON "objective_steps"("objectiveId", "key");

-- CreateIndex
CREATE INDEX "objective_events_objectiveId_createdAt_idx" ON "objective_events"("objectiveId", "createdAt");

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objectives" ADD CONSTRAINT "objectives_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_steps" ADD CONSTRAINT "objective_steps_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "objective_events" ADD CONSTRAINT "objective_events_objectiveId_fkey" FOREIGN KEY ("objectiveId") REFERENCES "objectives"("id") ON DELETE CASCADE ON UPDATE CASCADE;

