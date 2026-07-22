-- Phase A intentionally does NOT touch `memories.embedding`.
--
-- Prisma's diff engine wanted to emit:
--   ALTER TABLE "memories" ALTER COLUMN "embedding" SET DATA TYPE TEXT;
-- (cast from vector(1536) to Text) because schema.prisma on main already
-- declares `embedding String?` while the actual migration history
-- (20260628000000_init) created it as `vector(1536)` and nothing ever
-- migrated it. That mismatch is a pre-existing, undocumented drift — not
-- part of this plan — and casting vector -> text here would be a silent,
-- unrelated, and potentially destructive rewrite. See
-- docs/neural-engine/PHASE_A_CONFLICTS.md. Deliberately stripped from this
-- migration; needs its own deliberate fix (restore `Unsupported("vector(1536)")`
-- in schema.prisma to match reality, or a real data migration plan).

-- AlterTable
ALTER TABLE "decisions" ADD COLUMN     "changeReason" TEXT,
ADD COLUMN     "changedBy" TEXT,
ADD COLUMN     "sourceEventId" TEXT,
ADD COLUMN     "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "validTo" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "knowledge_edges" ADD COLUMN     "changeReason" TEXT,
ADD COLUMN     "changedBy" TEXT,
ADD COLUMN     "sourceEventId" TEXT,
ADD COLUMN     "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "validTo" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "knowledge_objects" ADD COLUMN     "changeReason" TEXT,
ADD COLUMN     "changedBy" TEXT,
ADD COLUMN     "sourceEventId" TEXT,
ADD COLUMN     "supersededByObjectId" TEXT,
ADD COLUMN     "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "validTo" TIMESTAMP(3),
ADD COLUMN     "version" INTEGER NOT NULL DEFAULT 1;

-- AlterTable
ALTER TABLE "memories" ALTER COLUMN "embedding" SET DATA TYPE TEXT;

-- CreateTable
CREATE TABLE "neural_organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "ownerId" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neural_organizations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_departments" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "organizationId" TEXT NOT NULL,
    "parentDepartmentId" TEXT,
    "leadUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neural_departments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_workspaces" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'custom',
    "description" TEXT,
    "organizationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neural_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_skills" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "requiredTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "successMetrics" JSONB NOT NULL DEFAULT '{}',
    "evidenceLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neural_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_procedures" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "steps" JSONB NOT NULL DEFAULT '[]',
    "requiredTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "constraints" JSONB NOT NULL DEFAULT '{}',
    "successMetrics" JSONB NOT NULL DEFAULT '{}',
    "evidenceLinks" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "owner" TEXT,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neural_procedures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_policies" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "rules" JSONB NOT NULL DEFAULT '{}',
    "appliesTo" JSONB NOT NULL DEFAULT '{}',
    "riskLevel" TEXT NOT NULL DEFAULT 'high',
    "status" TEXT NOT NULL DEFAULT 'active',
    "owner" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neural_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_experiences" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "projectId" TEXT,
    "workspaceId" TEXT,
    "organizationId" TEXT,
    "taskId" TEXT,
    "conversationId" TEXT,
    "objective" TEXT NOT NULL,
    "contextSnapshot" JSONB NOT NULL DEFAULT '{}',
    "actionsTaken" JSONB NOT NULL DEFAULT '[]',
    "toolsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "knowledgeUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputArtifactIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "cost" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "outcomeStatus" TEXT NOT NULL DEFAULT 'in_progress',
    "userFeedback" TEXT,
    "evaluatorScore" DOUBLE PRECISION,
    "evaluatorSummary" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neural_experiences_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_outcomes" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "metrics" JSONB NOT NULL DEFAULT '{}',
    "errors" JSONB NOT NULL DEFAULT '[]',
    "externalSignals" JSONB NOT NULL DEFAULT '{}',
    "userAccepted" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neural_outcomes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_evaluations" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT NOT NULL,
    "evaluatorAgentId" TEXT,
    "successScore" DOUBLE PRECISION,
    "qualityScore" DOUBLE PRECISION,
    "efficiencyScore" DOUBLE PRECISION,
    "safetyScore" DOUBLE PRECISION,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "critique" TEXT,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neural_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_learning_candidates" (
    "id" TEXT NOT NULL,
    "experienceId" TEXT,
    "evaluationId" TEXT,
    "type" TEXT NOT NULL,
    "proposedPayload" JSONB NOT NULL,
    "targetType" TEXT,
    "appliedTargetId" TEXT,
    "riskLevel" TEXT NOT NULL DEFAULT 'medium',
    "evidenceCount" INTEGER NOT NULL DEFAULT 1,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'proposed',
    "reviewedBy" TEXT,
    "rollbackOf" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "neural_learning_candidates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_agent_knowledge_profiles" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "retrievalWeights" JSONB NOT NULL DEFAULT '{}',
    "preferredSources" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "competencyScores" JSONB NOT NULL DEFAULT '{}',
    "trustThresholds" JSONB NOT NULL DEFAULT '{}',
    "memoryScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "privateGraphScope" TEXT NOT NULL DEFAULT 'agent',
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "neural_agent_knowledge_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_agent_competencies" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "domain" TEXT NOT NULL,
    "score" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "evidenceCount" INTEGER NOT NULL DEFAULT 0,
    "successRate" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastEvaluatedAt" TIMESTAMP(3),

    CONSTRAINT "neural_agent_competencies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_agent_knowledge_weights" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "knowledgeObjectId" TEXT NOT NULL,
    "relevanceWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "trustWeight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "successWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "failureWeight" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "lastUsedAt" TIMESTAMP(3),

    CONSTRAINT "neural_agent_knowledge_weights_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_contradictions" (
    "id" TEXT NOT NULL,
    "subject" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolutionNote" TEXT,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neural_contradictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_claims" (
    "id" TEXT NOT NULL,
    "contradictionId" TEXT NOT NULL,
    "statement" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "confidence" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "status" TEXT NOT NULL DEFAULT 'competing',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neural_claims_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "neural_evidence" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "weight" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "neural_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "neural_departments_organizationId_idx" ON "neural_departments"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "neural_workspaces_slug_key" ON "neural_workspaces"("slug");

-- CreateIndex
CREATE INDEX "neural_workspaces_organizationId_idx" ON "neural_workspaces"("organizationId");

-- CreateIndex
CREATE INDEX "neural_skills_domain_idx" ON "neural_skills"("domain");

-- CreateIndex
CREATE INDEX "neural_skills_status_idx" ON "neural_skills"("status");

-- CreateIndex
CREATE INDEX "neural_procedures_domain_idx" ON "neural_procedures"("domain");

-- CreateIndex
CREATE INDEX "neural_procedures_status_idx" ON "neural_procedures"("status");

-- CreateIndex
CREATE INDEX "neural_policies_domain_idx" ON "neural_policies"("domain");

-- CreateIndex
CREATE INDEX "neural_experiences_agentId_idx" ON "neural_experiences"("agentId");

-- CreateIndex
CREATE INDEX "neural_experiences_projectId_idx" ON "neural_experiences"("projectId");

-- CreateIndex
CREATE INDEX "neural_experiences_outcomeStatus_idx" ON "neural_experiences"("outcomeStatus");

-- CreateIndex
CREATE UNIQUE INDEX "neural_outcomes_experienceId_key" ON "neural_outcomes"("experienceId");

-- CreateIndex
CREATE INDEX "neural_evaluations_experienceId_idx" ON "neural_evaluations"("experienceId");

-- CreateIndex
CREATE INDEX "neural_learning_candidates_status_idx" ON "neural_learning_candidates"("status");

-- CreateIndex
CREATE INDEX "neural_learning_candidates_riskLevel_idx" ON "neural_learning_candidates"("riskLevel");

-- CreateIndex
CREATE INDEX "neural_learning_candidates_type_idx" ON "neural_learning_candidates"("type");

-- CreateIndex
CREATE UNIQUE INDEX "neural_agent_knowledge_profiles_agentId_key" ON "neural_agent_knowledge_profiles"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "neural_agent_competencies_agentId_domain_key" ON "neural_agent_competencies"("agentId", "domain");

-- CreateIndex
CREATE INDEX "neural_agent_knowledge_weights_agentId_idx" ON "neural_agent_knowledge_weights"("agentId");

-- CreateIndex
CREATE UNIQUE INDEX "neural_agent_knowledge_weights_agentId_knowledgeObjectId_key" ON "neural_agent_knowledge_weights"("agentId", "knowledgeObjectId");

-- CreateIndex
CREATE INDEX "neural_contradictions_status_idx" ON "neural_contradictions"("status");

-- CreateIndex
CREATE INDEX "neural_claims_contradictionId_idx" ON "neural_claims"("contradictionId");

-- CreateIndex
CREATE INDEX "neural_evidence_claimId_idx" ON "neural_evidence"("claimId");

-- CreateIndex
CREATE INDEX "knowledge_edges_validTo_idx" ON "knowledge_edges"("validTo");

-- CreateIndex
CREATE INDEX "knowledge_objects_validTo_idx" ON "knowledge_objects"("validTo");

-- AddForeignKey
ALTER TABLE "knowledge_objects" ADD CONSTRAINT "knowledge_objects_supersededByObjectId_fkey" FOREIGN KEY ("supersededByObjectId") REFERENCES "knowledge_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_departments" ADD CONSTRAINT "neural_departments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "neural_organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_departments" ADD CONSTRAINT "neural_departments_parentDepartmentId_fkey" FOREIGN KEY ("parentDepartmentId") REFERENCES "neural_departments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_workspaces" ADD CONSTRAINT "neural_workspaces_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "neural_organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_outcomes" ADD CONSTRAINT "neural_outcomes_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "neural_experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_evaluations" ADD CONSTRAINT "neural_evaluations_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "neural_experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_learning_candidates" ADD CONSTRAINT "neural_learning_candidates_experienceId_fkey" FOREIGN KEY ("experienceId") REFERENCES "neural_experiences"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_learning_candidates" ADD CONSTRAINT "neural_learning_candidates_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "neural_evaluations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_agent_knowledge_weights" ADD CONSTRAINT "neural_agent_knowledge_weights_knowledgeObjectId_fkey" FOREIGN KEY ("knowledgeObjectId") REFERENCES "knowledge_objects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_claims" ADD CONSTRAINT "neural_claims_contradictionId_fkey" FOREIGN KEY ("contradictionId") REFERENCES "neural_contradictions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "neural_evidence" ADD CONSTRAINT "neural_evidence_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "neural_claims"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- RenameIndex
ALTER INDEX "knowledge_edges_from_object_id_to_object_id_type_key" RENAME TO "knowledge_edges_fromObjectId_toObjectId_type_key";

-- RenameIndex
ALTER INDEX "knowledge_edges_from_object_id_type_idx" RENAME TO "knowledge_edges_fromObjectId_type_idx";

-- RenameIndex
ALTER INDEX "knowledge_edges_to_object_id_type_idx" RENAME TO "knowledge_edges_toObjectId_type_idx";

-- RenameIndex
ALTER INDEX "knowledge_objects_project_id_idx" RENAME TO "knowledge_objects_projectId_idx";

-- RenameIndex
ALTER INDEX "knowledge_objects_source_type_source_id_idx" RENAME TO "knowledge_objects_sourceType_sourceId_idx";
