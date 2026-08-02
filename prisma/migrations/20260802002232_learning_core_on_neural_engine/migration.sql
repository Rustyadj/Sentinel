-- DropIndex
DROP INDEX "knowledge_objects_sourceType_sourceId_idx";

-- AlterTable
ALTER TABLE "neural_experiences" ADD COLUMN     "constraints" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "parentTraceId" TEXT,
ADD COLUMN     "successCriteria" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "underlyingGoal" TEXT;

-- AlterTable
ALTER TABLE "neural_learning_candidates" ADD COLUMN     "approvalRequestId" TEXT,
ADD COLUMN     "knowledgeGapId" TEXT,
ADD COLUMN     "problem" TEXT,
ADD COLUMN     "rollbackCriteria" JSONB,
ADD COLUMN     "rolloutPlan" JSONB,
ADD COLUMN     "rootCause" TEXT,
ADD COLUMN     "shadowConfidence" DOUBLE PRECISION,
ADD COLUMN     "shadowSampleSize" INTEGER,
ADD COLUMN     "testPlan" JSONB;

-- AlterTable
ALTER TABLE "neural_skills" ADD COLUMN     "inputSchema" JSONB,
ADD COLUMN     "outputSchema" JSONB,
ADD COLUMN     "permissions" JSONB NOT NULL DEFAULT '[]',
ADD COLUMN     "tests" JSONB NOT NULL DEFAULT '[]';

-- CreateTable
CREATE TABLE "learning_events" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "sourceType" TEXT,
    "sourceId" TEXT,
    "agentId" TEXT,
    "userId" TEXT,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "chatRoomId" TEXT,
    "messageId" TEXT,
    "workflowId" TEXT,
    "taskId" TEXT,
    "traceId" TEXT,
    "parentTraceId" TEXT,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "payload" JSONB NOT NULL DEFAULT '{}',
    "redactedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_curiosity_events" (
    "id" TEXT NOT NULL,
    "traceId" TEXT,
    "agentId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "triggerType" TEXT NOT NULL,
    "question" TEXT,
    "reason" TEXT,
    "confidenceBefore" DOUBLE PRECISION,
    "ambiguityScore" DOUBLE PRECISION,
    "noveltyScore" DOUBLE PRECISION,
    "conflictScore" DOUBLE PRECISION,
    "businessImpactScore" DOUBLE PRECISION,
    "urgencyScore" DOUBLE PRECISION,
    "curiosityScore" DOUBLE PRECISION NOT NULL,
    "asked" BOOLEAN NOT NULL DEFAULT false,
    "answered" BOOLEAN NOT NULL DEFAULT false,
    "answerSummary" TEXT,
    "outcome" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "answeredAt" TIMESTAMP(3),

    CONSTRAINT "learning_curiosity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_reflections" (
    "id" TEXT NOT NULL,
    "traceId" TEXT,
    "agentId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "reflectionType" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "whatWorked" TEXT,
    "whatFailed" TEXT,
    "unexpectedResults" TEXT,
    "incorrectAssumptions" TEXT,
    "missingInformation" TEXT,
    "reusableLesson" TEXT,
    "suggestedImprovement" TEXT,
    "shouldCreateSkill" BOOLEAN NOT NULL DEFAULT false,
    "shouldAskNextTime" BOOLEAN NOT NULL DEFAULT false,
    "confidence" DOUBLE PRECISION,
    "status" TEXT NOT NULL DEFAULT 'open',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_reflections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_preference_evidence" (
    "id" TEXT NOT NULL,
    "memoryId" TEXT NOT NULL,
    "userId" TEXT,
    "agentId" TEXT,
    "workspaceId" TEXT,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "evidence" TEXT NOT NULL,
    "evidenceWeight" DOUBLE PRECISION NOT NULL DEFAULT 1,
    "supportsPreference" BOOLEAN NOT NULL DEFAULT true,
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "learning_preference_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_goal_alignment_checks" (
    "id" TEXT NOT NULL,
    "traceId" TEXT,
    "agentId" TEXT,
    "alignmentScore" DOUBLE PRECISION NOT NULL,
    "conflicts" JSONB NOT NULL DEFAULT '[]',
    "unsupportedAssumptions" JSONB NOT NULL DEFAULT '[]',
    "recommendedClarification" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_goal_alignment_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_knowledge_gaps" (
    "id" TEXT NOT NULL,
    "agentId" TEXT,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "topic" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "source" TEXT,
    "frequency" INTEGER NOT NULL DEFAULT 1,
    "businessImpact" DOUBLE PRECISION,
    "failureImpact" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priorityScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'detected',
    "recommendedAction" TEXT,
    "relatedTraceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "learning_knowledge_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_goals" (
    "id" TEXT NOT NULL,
    "knowledgeGapId" TEXT,
    "agentId" TEXT,
    "workspaceId" TEXT,
    "title" TEXT NOT NULL,
    "objective" TEXT NOT NULL,
    "successCriteria" JSONB NOT NULL DEFAULT '[]',
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "learning_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_experiment_runs" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "traceId" TEXT,
    "variant" TEXT NOT NULL,
    "inputSnapshot" JSONB NOT NULL DEFAULT '{}',
    "outputSnapshot" JSONB NOT NULL DEFAULT '{}',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "passed" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_experiment_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_benchmark_definitions" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "workspaceId" TEXT,
    "inputDataset" JSONB NOT NULL DEFAULT '[]',
    "scoringMethod" TEXT NOT NULL,
    "weights" JSONB NOT NULL DEFAULT '{}',
    "thresholds" JSONB NOT NULL DEFAULT '{}',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_benchmark_definitions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_benchmark_results" (
    "id" TEXT NOT NULL,
    "benchmarkId" TEXT NOT NULL,
    "candidateId" TEXT,
    "agentId" TEXT,
    "version" TEXT,
    "accuracy" DOUBLE PRECISION,
    "latency" DOUBLE PRECISION,
    "cost" DOUBLE PRECISION,
    "completionRate" DOUBLE PRECISION,
    "toolEfficiency" DOUBLE PRECISION,
    "memoryQuality" DOUBLE PRECISION,
    "retrievalQuality" DOUBLE PRECISION,
    "clarificationQuality" DOUBLE PRECISION,
    "userAcceptance" DOUBLE PRECISION,
    "hallucinationRate" DOUBLE PRECISION,
    "safetyViolations" INTEGER NOT NULL DEFAULT 0,
    "overallScore" DOUBLE PRECISION,
    "rawMetrics" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_benchmark_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_trust_events" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "domain" TEXT,
    "eventType" TEXT NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "traceId" TEXT,
    "candidateId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_trust_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "scopeType" TEXT NOT NULL DEFAULT 'global',
    "scopeId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 0,
    "variant" TEXT,
    "config" JSONB NOT NULL DEFAULT '{}',
    "riskTier" TEXT NOT NULL DEFAULT 'low',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_skill_versions" (
    "id" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "implementationType" TEXT,
    "implementation" JSONB,
    "dependencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "inputSchema" JSONB,
    "outputSchema" JSONB,
    "permissions" JSONB NOT NULL DEFAULT '[]',
    "tests" JSONB NOT NULL DEFAULT '[]',
    "benchmarkResultIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),

    CONSTRAINT "learning_skill_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_experience_replay_runs" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceTraceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "summary" TEXT NOT NULL,
    "lessons" JSONB NOT NULL DEFAULT '[]',
    "improvementOpportunities" JSONB NOT NULL DEFAULT '[]',
    "knowledgeGapIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "runDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_experience_replay_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_artifact_versions" (
    "id" TEXT NOT NULL,
    "artifactType" TEXT NOT NULL,
    "artifactKey" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content" JSONB NOT NULL,
    "checksum" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdByAgentId" TEXT,
    "approvedByUserId" TEXT,
    "candidateId" TEXT,
    "previousVersionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "activatedAt" TIMESTAMP(3),
    "retiredAt" TIMESTAMP(3),

    CONSTRAINT "learning_artifact_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_scheduled_job_runs" (
    "id" TEXT NOT NULL,
    "jobKey" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "result" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_scheduled_job_runs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_events_traceId_idx" ON "learning_events"("traceId");

-- CreateIndex
CREATE INDEX "learning_events_agentId_createdAt_idx" ON "learning_events"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "learning_events_workspaceId_createdAt_idx" ON "learning_events"("workspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "learning_events_eventType_createdAt_idx" ON "learning_events"("eventType", "createdAt");

-- CreateIndex
CREATE INDEX "learning_curiosity_events_agentId_createdAt_idx" ON "learning_curiosity_events"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "learning_curiosity_events_traceId_idx" ON "learning_curiosity_events"("traceId");

-- CreateIndex
CREATE INDEX "learning_reflections_agentId_createdAt_idx" ON "learning_reflections"("agentId", "createdAt");

-- CreateIndex
CREATE INDEX "learning_reflections_traceId_idx" ON "learning_reflections"("traceId");

-- CreateIndex
CREATE INDEX "learning_preference_evidence_memoryId_idx" ON "learning_preference_evidence"("memoryId");

-- CreateIndex
CREATE INDEX "learning_goal_alignment_checks_traceId_idx" ON "learning_goal_alignment_checks"("traceId");

-- CreateIndex
CREATE INDEX "learning_knowledge_gaps_agentId_idx" ON "learning_knowledge_gaps"("agentId");

-- CreateIndex
CREATE INDEX "learning_knowledge_gaps_workspaceId_idx" ON "learning_knowledge_gaps"("workspaceId");

-- CreateIndex
CREATE INDEX "learning_knowledge_gaps_status_idx" ON "learning_knowledge_gaps"("status");

-- CreateIndex
CREATE INDEX "learning_goals_knowledgeGapId_idx" ON "learning_goals"("knowledgeGapId");

-- CreateIndex
CREATE INDEX "learning_experiment_runs_candidateId_idx" ON "learning_experiment_runs"("candidateId");

-- CreateIndex
CREATE INDEX "learning_benchmark_definitions_category_idx" ON "learning_benchmark_definitions"("category");

-- CreateIndex
CREATE INDEX "learning_benchmark_results_benchmarkId_idx" ON "learning_benchmark_results"("benchmarkId");

-- CreateIndex
CREATE INDEX "learning_benchmark_results_candidateId_idx" ON "learning_benchmark_results"("candidateId");

-- CreateIndex
CREATE INDEX "learning_trust_events_agentId_createdAt_idx" ON "learning_trust_events"("agentId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "learning_feature_flags_key_key" ON "learning_feature_flags"("key");

-- CreateIndex
CREATE UNIQUE INDEX "learning_skill_versions_skillId_version_key" ON "learning_skill_versions"("skillId", "version");

-- CreateIndex
CREATE INDEX "learning_experience_replay_runs_category_idx" ON "learning_experience_replay_runs"("category");

-- CreateIndex
CREATE UNIQUE INDEX "learning_artifact_versions_artifactType_artifactKey_version_key" ON "learning_artifact_versions"("artifactType", "artifactKey", "version");

-- CreateIndex
CREATE INDEX "learning_scheduled_job_runs_jobKey_startedAt_idx" ON "learning_scheduled_job_runs"("jobKey", "startedAt");

-- CreateIndex
CREATE INDEX "neural_learning_candidates_knowledgeGapId_idx" ON "neural_learning_candidates"("knowledgeGapId");

-- CreateIndex
CREATE INDEX "neural_learning_candidates_approvalRequestId_idx" ON "neural_learning_candidates"("approvalRequestId");

-- AddForeignKey
ALTER TABLE "neural_learning_candidates" ADD CONSTRAINT "neural_learning_candidates_knowledgeGapId_fkey" FOREIGN KEY ("knowledgeGapId") REFERENCES "learning_knowledge_gaps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_learning_candidates" ADD CONSTRAINT "neural_learning_candidates_approvalRequestId_fkey" FOREIGN KEY ("approvalRequestId") REFERENCES "approval_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_preference_evidence" ADD CONSTRAINT "learning_preference_evidence_memoryId_fkey" FOREIGN KEY ("memoryId") REFERENCES "memories"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_goals" ADD CONSTRAINT "learning_goals_knowledgeGapId_fkey" FOREIGN KEY ("knowledgeGapId") REFERENCES "learning_knowledge_gaps"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_experiment_runs" ADD CONSTRAINT "learning_experiment_runs_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_benchmark_results" ADD CONSTRAINT "learning_benchmark_results_benchmarkId_fkey" FOREIGN KEY ("benchmarkId") REFERENCES "learning_benchmark_definitions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_benchmark_results" ADD CONSTRAINT "learning_benchmark_results_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_trust_events" ADD CONSTRAINT "learning_trust_events_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_skill_versions" ADD CONSTRAINT "learning_skill_versions_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "neural_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_artifact_versions" ADD CONSTRAINT "learning_artifact_versions_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_artifact_versions" ADD CONSTRAINT "learning_artifact_versions_previousVersionId_fkey" FOREIGN KEY ("previousVersionId") REFERENCES "learning_artifact_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;
