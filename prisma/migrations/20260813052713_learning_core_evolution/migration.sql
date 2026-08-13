-- AlterTable
ALTER TABLE "learning_settings" ADD COLUMN     "dailyExperimentBudget" INTEGER,
ADD COLUMN     "dailyModelBudgetUsd" DOUBLE PRECISION,
ADD COLUMN     "dailyTokenBudget" INTEGER,
ADD COLUMN     "maxAdversarialRunsPerDay" INTEGER,
ADD COLUMN     "maxCandidatesPerOpportunity" INTEGER,
ADD COLUMN     "maxConcurrentExperiments" INTEGER,
ADD COLUMN     "maxReplaySamples" INTEGER;

-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "confirmationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "contradictionCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "harmScore" DOUBLE PRECISION,
ADD COLUMN     "lastUsefulAt" TIMESTAMP(3),
ADD COLUMN     "lastValidatedAt" TIMESTAMP(3),
ADD COLUMN     "poisonRisk" DOUBLE PRECISION,
ADD COLUMN     "provenanceTrust" DOUBLE PRECISION,
ADD COLUMN     "retrievalCost" DOUBLE PRECISION,
ADD COLUMN     "stalenessScore" DOUBLE PRECISION,
ADD COLUMN     "state" TEXT NOT NULL DEFAULT 'active',
ADD COLUMN     "transferability" DOUBLE PRECISION,
ADD COLUMN     "valueScore" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "neural_learning_candidates" ADD COLUMN     "archiveStatus" TEXT NOT NULL DEFAULT 'retained',
ADD COLUMN     "championGroup" TEXT,
ADD COLUMN     "createdFrom" TEXT,
ADD COLUMN     "evaluationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "evaluatorModel" TEXT,
ADD COLUMN     "fitnessScore" DOUBLE PRECISION,
ADD COLUMN     "fitnessVector" JSONB,
ADD COLUMN     "generation" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "generatorModel" TEXT,
ADD COLUMN     "lineageDepth" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "mutationType" TEXT,
ADD COLUMN     "noveltyScore" DOUBLE PRECISION,
ADD COLUMN     "parentCandidateId" TEXT,
ADD COLUMN     "rootCandidateId" TEXT,
ADD COLUMN     "survivalStatus" TEXT NOT NULL DEFAULT 'generated';

-- CreateTable
CREATE TABLE "learning_eval_suites" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "category" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_eval_suites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_eval_cases" (
    "id" TEXT NOT NULL,
    "suiteId" TEXT,
    "source" TEXT NOT NULL,
    "sourceId" TEXT,
    "userId" TEXT,
    "workspaceId" TEXT,
    "failureType" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "sanitizedInput" JSONB NOT NULL DEFAULT '{}',
    "expectedBehavior" TEXT NOT NULL,
    "grader" TEXT NOT NULL DEFAULT 'rule_based',
    "graderVersion" TEXT NOT NULL DEFAULT 'v1',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'active',
    "dedupeKey" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "redactedKeys" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_eval_cases_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_eval_runs" (
    "id" TEXT NOT NULL,
    "suiteId" TEXT,
    "candidateId" TEXT,
    "triggeredBy" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "learning_eval_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_eval_results" (
    "id" TEXT NOT NULL,
    "evalRunId" TEXT NOT NULL,
    "evalCaseId" TEXT NOT NULL,
    "candidateId" TEXT,
    "passed" BOOLEAN NOT NULL,
    "score" DOUBLE PRECISION,
    "actualBehavior" TEXT,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_eval_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_guardian_decisions" (
    "id" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "runtime" TEXT,
    "candidateId" TEXT,
    "tier" INTEGER NOT NULL,
    "mode" TEXT NOT NULL,
    "risk" TEXT NOT NULL,
    "policyDecision" TEXT NOT NULL,
    "guardianDecision" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION,
    "reasonCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_guardian_decisions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_adversarial_runs" (
    "id" TEXT NOT NULL,
    "attackType" TEXT NOT NULL,
    "candidateId" TEXT,
    "championCandidateId" TEXT,
    "payload" JSONB NOT NULL,
    "targetSurface" TEXT NOT NULL,
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "severity" TEXT NOT NULL DEFAULT 'medium',
    "judgeNotes" TEXT,
    "sandboxViolation" BOOLEAN NOT NULL DEFAULT false,
    "evalCaseId" TEXT,
    "workspaceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "learning_adversarial_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_principles" (
    "id" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "scope" TEXT NOT NULL,
    "domain" TEXT,
    "workspaceId" TEXT,
    "agentId" TEXT,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "supportingExperienceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contradictingExperienceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" TEXT NOT NULL DEFAULT 'active',
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "lastValidatedAt" TIMESTAMP(3),

    CONSTRAINT "learning_principles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_principle_versions" (
    "id" TEXT NOT NULL,
    "principleId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "statement" TEXT NOT NULL,
    "conditions" JSONB NOT NULL DEFAULT '[]',
    "exceptions" JSONB NOT NULL DEFAULT '[]',
    "confidence" DOUBLE PRECISION NOT NULL,
    "changeReason" TEXT NOT NULL,
    "supportingExperienceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "contradictingExperienceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_principle_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_experiment_manifests" (
    "id" TEXT NOT NULL,
    "candidateId" TEXT NOT NULL,
    "championVersion" TEXT,
    "candidateVersion" TEXT,
    "evalSuiteIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "sandboxVersion" TEXT,
    "modelVersion" TEXT,
    "toolVersions" JSONB NOT NULL DEFAULT '{}',
    "memorySnapshotRef" TEXT,
    "datasetHash" TEXT,
    "graderVersions" JSONB NOT NULL DEFAULT '{}',
    "randomSeed" TEXT,
    "stage" TEXT NOT NULL DEFAULT 'static_validation',
    "stopReason" TEXT,
    "results" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "learning_experiment_manifests_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_eval_suites_category_idx" ON "learning_eval_suites"("category");

-- CreateIndex
CREATE INDEX "learning_eval_suites_workspaceId_idx" ON "learning_eval_suites"("workspaceId");

-- CreateIndex
CREATE UNIQUE INDEX "learning_eval_cases_dedupeKey_key" ON "learning_eval_cases"("dedupeKey");

-- CreateIndex
CREATE INDEX "learning_eval_cases_suiteId_idx" ON "learning_eval_cases"("suiteId");

-- CreateIndex
CREATE INDEX "learning_eval_cases_source_idx" ON "learning_eval_cases"("source");

-- CreateIndex
CREATE INDEX "learning_eval_cases_failureType_idx" ON "learning_eval_cases"("failureType");

-- CreateIndex
CREATE INDEX "learning_eval_cases_workspaceId_idx" ON "learning_eval_cases"("workspaceId");

-- CreateIndex
CREATE INDEX "learning_eval_runs_suiteId_idx" ON "learning_eval_runs"("suiteId");

-- CreateIndex
CREATE INDEX "learning_eval_runs_candidateId_idx" ON "learning_eval_runs"("candidateId");

-- CreateIndex
CREATE INDEX "learning_eval_results_evalRunId_idx" ON "learning_eval_results"("evalRunId");

-- CreateIndex
CREATE INDEX "learning_eval_results_evalCaseId_idx" ON "learning_eval_results"("evalCaseId");

-- CreateIndex
CREATE INDEX "learning_eval_results_candidateId_idx" ON "learning_eval_results"("candidateId");

-- CreateIndex
CREATE INDEX "learning_guardian_decisions_candidateId_idx" ON "learning_guardian_decisions"("candidateId");

-- CreateIndex
CREATE INDEX "learning_guardian_decisions_mode_idx" ON "learning_guardian_decisions"("mode");

-- CreateIndex
CREATE INDEX "learning_guardian_decisions_tier_idx" ON "learning_guardian_decisions"("tier");

-- CreateIndex
CREATE INDEX "learning_adversarial_runs_candidateId_idx" ON "learning_adversarial_runs"("candidateId");

-- CreateIndex
CREATE INDEX "learning_adversarial_runs_attackType_idx" ON "learning_adversarial_runs"("attackType");

-- CreateIndex
CREATE INDEX "learning_adversarial_runs_outcome_idx" ON "learning_adversarial_runs"("outcome");

-- CreateIndex
CREATE INDEX "learning_principles_domain_idx" ON "learning_principles"("domain");

-- CreateIndex
CREATE INDEX "learning_principles_workspaceId_idx" ON "learning_principles"("workspaceId");

-- CreateIndex
CREATE INDEX "learning_principles_agentId_idx" ON "learning_principles"("agentId");

-- CreateIndex
CREATE INDEX "learning_principles_status_idx" ON "learning_principles"("status");

-- CreateIndex
CREATE UNIQUE INDEX "learning_principle_versions_principleId_version_key" ON "learning_principle_versions"("principleId", "version");

-- CreateIndex
CREATE INDEX "learning_experiment_manifests_candidateId_idx" ON "learning_experiment_manifests"("candidateId");

-- CreateIndex
CREATE INDEX "memories_state_idx" ON "memories"("state");

-- CreateIndex
CREATE INDEX "neural_learning_candidates_parentCandidateId_idx" ON "neural_learning_candidates"("parentCandidateId");

-- CreateIndex
CREATE INDEX "neural_learning_candidates_rootCandidateId_idx" ON "neural_learning_candidates"("rootCandidateId");

-- CreateIndex
CREATE INDEX "neural_learning_candidates_survivalStatus_idx" ON "neural_learning_candidates"("survivalStatus");

-- CreateIndex
CREATE INDEX "neural_learning_candidates_championGroup_idx" ON "neural_learning_candidates"("championGroup");

-- AddForeignKey
ALTER TABLE "neural_learning_candidates" ADD CONSTRAINT "neural_learning_candidates_parentCandidateId_fkey" FOREIGN KEY ("parentCandidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_eval_cases" ADD CONSTRAINT "learning_eval_cases_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "learning_eval_suites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_eval_runs" ADD CONSTRAINT "learning_eval_runs_suiteId_fkey" FOREIGN KEY ("suiteId") REFERENCES "learning_eval_suites"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_eval_runs" ADD CONSTRAINT "learning_eval_runs_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_eval_results" ADD CONSTRAINT "learning_eval_results_evalRunId_fkey" FOREIGN KEY ("evalRunId") REFERENCES "learning_eval_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_eval_results" ADD CONSTRAINT "learning_eval_results_evalCaseId_fkey" FOREIGN KEY ("evalCaseId") REFERENCES "learning_eval_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_eval_results" ADD CONSTRAINT "learning_eval_results_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_guardian_decisions" ADD CONSTRAINT "learning_guardian_decisions_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_adversarial_runs" ADD CONSTRAINT "learning_adversarial_runs_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_adversarial_runs" ADD CONSTRAINT "learning_adversarial_runs_evalCaseId_fkey" FOREIGN KEY ("evalCaseId") REFERENCES "learning_eval_cases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_principle_versions" ADD CONSTRAINT "learning_principle_versions_principleId_fkey" FOREIGN KEY ("principleId") REFERENCES "learning_principles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_experiment_manifests" ADD CONSTRAINT "learning_experiment_manifests_candidateId_fkey" FOREIGN KEY ("candidateId") REFERENCES "neural_learning_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
