-- CreateTable
CREATE TABLE "learning_curiosity_events" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL,
    "factors" JSONB NOT NULL,
    "triggerContext" TEXT,
    "question" TEXT,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolution" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_curiosity_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_knowledge_gaps" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "occurrenceCount" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "priority" TEXT NOT NULL DEFAULT 'medium',
    "status" TEXT NOT NULL DEFAULT 'open',
    "estimatedBenefit" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_knowledge_gaps_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_reflections" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "taskRef" TEXT,
    "wentWell" TEXT,
    "wentWrong" TEXT,
    "surprises" TEXT,
    "wrongAssumptions" TEXT,
    "missingInfo" TEXT,
    "shouldRemember" TEXT,
    "skillIdea" TEXT,
    "shouldAskMore" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_reflections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_replay_entries" (
    "id" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "sourceRef" TEXT,
    "summary" TEXT NOT NULL,
    "lessons" JSONB NOT NULL DEFAULT '[]',
    "improvementOpportunities" JSONB NOT NULL DEFAULT '[]',
    "runDate" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_replay_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_preferences" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "sourceConversationIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastConfirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "conflicts" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_goals" (
    "id" TEXT NOT NULL,
    "taskRef" TEXT,
    "requestedGoal" TEXT NOT NULL,
    "underlyingGoal" TEXT,
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "successCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "hiddenPreferences" JSONB NOT NULL DEFAULT '{}',
    "businessImpact" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_goals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_goal_alignment_checks" (
    "id" TEXT NOT NULL,
    "goalId" TEXT,
    "actionRef" TEXT NOT NULL,
    "alignmentScore" DOUBLE PRECISION NOT NULL,
    "suggestion" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_goal_alignment_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_hypotheses" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "problem" TEXT NOT NULL,
    "rootCause" TEXT,
    "expectedImprovement" TEXT NOT NULL,
    "risk" TEXT NOT NULL DEFAULT 'low',
    "affectedSystems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "metrics" JSONB NOT NULL DEFAULT '[]',
    "rollbackPlan" TEXT NOT NULL,
    "successCriteria" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_hypotheses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_experiments" (
    "id" TEXT NOT NULL,
    "hypothesisId" TEXT,
    "type" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT '1.0.0',
    "ownerId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'shadow',
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "learning_experiments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_benchmarks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "metric" TEXT NOT NULL,
    "value" DOUBLE PRECISION NOT NULL,
    "baselineValue" DOUBLE PRECISION,
    "experimentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_benchmarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_agent_trust_scores" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 50,
    "accuracy" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "rollbackCount" INTEGER NOT NULL DEFAULT 0,
    "hallucinations" INTEGER NOT NULL DEFAULT 0,
    "unsafeEvents" INTEGER NOT NULL DEFAULT 0,
    "failedExperiments" INTEGER NOT NULL DEFAULT 0,
    "overrides" INTEGER NOT NULL DEFAULT 0,
    "approvedImprovements" INTEGER NOT NULL DEFAULT 0,
    "benchmarkWins" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_agent_trust_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_trust_events" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "delta" DOUBLE PRECISION NOT NULL,
    "reason" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_trust_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "dependencies" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tests" JSONB NOT NULL DEFAULT '[]',
    "benchmarks" JSONB NOT NULL DEFAULT '[]',
    "ownerId" TEXT,
    "version" TEXT NOT NULL DEFAULT '0.1.0',
    "approvalLevel" INTEGER NOT NULL DEFAULT 1,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_evolution_events" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL,
    "relatedType" TEXT,
    "relatedId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "learning_evolution_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "learning_feature_flags" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "scope" TEXT NOT NULL DEFAULT 'global',
    "scopeId" TEXT,
    "rolloutPercentage" INTEGER NOT NULL DEFAULT 0,
    "autoRollbackThreshold" DOUBLE PRECISION,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "learning_feature_flags_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "learning_curiosity_events_agentId_idx" ON "learning_curiosity_events"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "learning_knowledge_gaps_agentId_topic_key" ON "learning_knowledge_gaps"("agentId", "topic");

-- CreateIndex
CREATE INDEX "learning_reflections_agentId_idx" ON "learning_reflections"("agentId");

-- CreateIndex
CREATE INDEX "learning_replay_entries_category_idx" ON "learning_replay_entries"("category");

-- CreateIndex
CREATE UNIQUE INDEX "learning_preferences_userId_key_key" ON "learning_preferences"("userId", "key");

-- CreateIndex
CREATE INDEX "learning_goal_alignment_checks_goalId_idx" ON "learning_goal_alignment_checks"("goalId");

-- CreateIndex
CREATE INDEX "learning_experiments_hypothesisId_idx" ON "learning_experiments"("hypothesisId");

-- CreateIndex
CREATE INDEX "learning_benchmarks_experimentId_idx" ON "learning_benchmarks"("experimentId");

-- CreateIndex
CREATE UNIQUE INDEX "learning_agent_trust_scores_agentId_key" ON "learning_agent_trust_scores"("agentId");

-- CreateIndex
CREATE INDEX "learning_trust_events_agentId_idx" ON "learning_trust_events"("agentId");

-- CreateIndex
CREATE INDEX "learning_evolution_events_relatedType_relatedId_idx" ON "learning_evolution_events"("relatedType", "relatedId");

-- CreateIndex
CREATE UNIQUE INDEX "learning_feature_flags_key_key" ON "learning_feature_flags"("key");

-- AddForeignKey
ALTER TABLE "learning_curiosity_events" ADD CONSTRAINT "learning_curiosity_events_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_knowledge_gaps" ADD CONSTRAINT "learning_knowledge_gaps_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_reflections" ADD CONSTRAINT "learning_reflections_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_goal_alignment_checks" ADD CONSTRAINT "learning_goal_alignment_checks_goalId_fkey" FOREIGN KEY ("goalId") REFERENCES "learning_goals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_experiments" ADD CONSTRAINT "learning_experiments_hypothesisId_fkey" FOREIGN KEY ("hypothesisId") REFERENCES "learning_hypotheses"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_benchmarks" ADD CONSTRAINT "learning_benchmarks_experimentId_fkey" FOREIGN KEY ("experimentId") REFERENCES "learning_experiments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_agent_trust_scores" ADD CONSTRAINT "learning_agent_trust_scores_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "learning_trust_events" ADD CONSTRAINT "learning_trust_events_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
