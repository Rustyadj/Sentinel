-- Adaptive memory, skill refinery, workflow governance, and MCP control plane.
-- Additive by default; existing legacy memory rows are not promoted or altered.

DROP INDEX IF EXISTS "knowledge_objects_sourceType_sourceId_userId_key";
CREATE INDEX "knowledge_objects_sourceType_sourceId_userId_validTo_idx"
  ON "knowledge_objects"("sourceType", "sourceId", "userId", "validTo");
CREATE UNIQUE INDEX "knowledge_objects_current_source_owner_key"
  ON "knowledge_objects"("sourceType", "sourceId", COALESCE("userId", ''))
  WHERE "validTo" IS NULL;

ALTER TABLE "workflows"
  ADD COLUMN "workspaceId" TEXT,
  ADD COLUMN "organizationId" TEXT,
  ADD COLUMN "operatorAgentId" TEXT,
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "approvalStatus" TEXT NOT NULL DEFAULT 'draft',
  ADD COLUMN "lastRunAt" TIMESTAMP(3),
  ADD COLUMN "lastSuccessfulAt" TIMESTAMP(3),
  ADD COLUMN "nextRunAt" TIMESTAMP(3),
  ADD COLUMN "failureCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "retryState" TEXT,
  ADD COLUMN "credentialStatus" TEXT,
  ADD COLUMN "toolStatus" TEXT,
  ADD COLUMN "staleOutputAt" TIMESTAMP(3),
  ADD COLUMN "lastRuntimeMs" INTEGER,
  ADD COLUMN "lastCost" DOUBLE PRECISION,
  ADD COLUMN "disabledAt" TIMESTAMP(3),
  ADD COLUMN "rollbackWorkflowId" TEXT;
CREATE INDEX "workflows_workspaceId_status_idx" ON "workflows"("workspaceId", "status");

ALTER TABLE "neural_experiences"
  ADD COLUMN "requestId" TEXT,
  ADD COLUMN "actingUserId" TEXT,
  ADD COLUMN "maxRuntimeMs" INTEGER,
  ADD COLUMN "maxCost" DOUBLE PRECISION,
  ADD COLUMN "cancelledAt" TIMESTAMP(3);

CREATE INDEX "messages_content_fts_idx" ON "messages" USING GIN (to_tsvector('english', "content"));
CREATE INDEX "neural_experiences_trajectory_fts_idx" ON "neural_experiences" USING GIN
  (to_tsvector('english', coalesce("objective", '') || ' ' || coalesce("userFeedback", '') || ' ' || coalesce("evaluatorSummary", '')));
CREATE INDEX "neural_evaluations_feedback_fts_idx" ON "neural_evaluations" USING GIN (to_tsvector('english', coalesce("critique", '')));

CREATE TABLE "adaptive_memory_candidates" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "userId" TEXT,
  "agentId" TEXT,
  "runId" TEXT,
  "conversationId" TEXT,
  "candidateType" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "structuredPayload" JSONB,
  "sourceType" TEXT NOT NULL,
  "sourceTrust" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "importance" DOUBLE PRECISION NOT NULL,
  "risk" DOUBLE PRECISION NOT NULL,
  "provenance" JSONB NOT NULL,
  "expiresAt" TIMESTAMP(3),
  "reviewAt" TIMESTAMP(3),
  "supersedesId" TEXT,
  "contradictsIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "proposedBy" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "quarantineReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "appliedTargetType" TEXT,
  "appliedTargetId" TEXT,
  "reviewedBy" TEXT,
  "reviewNote" TEXT,
  "approvalRequestId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  "rolledBackAt" TIMESTAMP(3),
  CONSTRAINT "adaptive_memory_candidates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_memory_candidates_workspaceId_status_idx" ON "adaptive_memory_candidates"("workspaceId", "status");
CREATE INDEX "adaptive_memory_candidates_projectId_status_idx" ON "adaptive_memory_candidates"("projectId", "status");
CREATE INDEX "adaptive_memory_candidates_userId_status_idx" ON "adaptive_memory_candidates"("userId", "status");
CREATE INDEX "adaptive_memory_candidates_expiresAt_idx" ON "adaptive_memory_candidates"("expiresAt");

CREATE TABLE "adaptive_active_memory_snapshots" (
  "id" TEXT NOT NULL,
  "runId" TEXT NOT NULL,
  "userId" TEXT,
  "agentId" TEXT NOT NULL,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "objective" TEXT NOT NULL,
  "card" JSONB NOT NULL,
  "renderedText" TEXT NOT NULL,
  "estimatedTokens" INTEGER NOT NULL,
  "maxTokens" INTEGER NOT NULL,
  "contentHash" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_active_memory_snapshots_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "adaptive_active_memory_snapshots_runId_key" ON "adaptive_active_memory_snapshots"("runId");
CREATE INDEX "adaptive_active_memory_snapshots_workspaceId_createdAt_idx" ON "adaptive_active_memory_snapshots"("workspaceId", "createdAt");

CREATE TABLE "adaptive_memory_index" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "userId" TEXT,
  "agentId" TEXT,
  "scope" TEXT NOT NULL,
  "topic" TEXT NOT NULL,
  "summary" TEXT NOT NULL,
  "detailObjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sourceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "tokenEstimate" INTEGER NOT NULL,
  "importance" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
  "validFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "validTo" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "adaptive_memory_index_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_memory_index_workspaceId_projectId_topic_idx" ON "adaptive_memory_index"("workspaceId", "projectId", "topic");
CREATE INDEX "adaptive_memory_index_userId_agentId_idx" ON "adaptive_memory_index"("userId", "agentId");
CREATE INDEX "adaptive_memory_index_validTo_idx" ON "adaptive_memory_index"("validTo");

CREATE TABLE "adaptive_retrieval_traces" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "runId" TEXT,
  "query" TEXT NOT NULL,
  "userId" TEXT,
  "agentId" TEXT,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "maxTokens" INTEGER NOT NULL,
  "selectedTokens" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'started',
  "scoringVersion" TEXT NOT NULL,
  "durationMs" INTEGER,
  "outputInfluenceSet" BOOLEAN NOT NULL DEFAULT false,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "adaptive_retrieval_traces_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_retrieval_traces_workspaceId_createdAt_idx" ON "adaptive_retrieval_traces"("workspaceId", "createdAt");
CREATE INDEX "adaptive_retrieval_traces_projectId_createdAt_idx" ON "adaptive_retrieval_traces"("projectId", "createdAt");
CREATE INDEX "adaptive_retrieval_traces_runId_idx" ON "adaptive_retrieval_traces"("runId");

CREATE TABLE "adaptive_retrieval_trace_items" (
  "id" TEXT NOT NULL,
  "traceId" TEXT NOT NULL,
  "knowledgeObjectId" TEXT,
  "sourceType" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "semanticScore" DOUBLE PRECISION NOT NULL,
  "keywordScore" DOUBLE PRECISION NOT NULL,
  "graphScore" DOUBLE PRECISION NOT NULL,
  "scopeScore" DOUBLE PRECISION NOT NULL,
  "recencyScore" DOUBLE PRECISION NOT NULL,
  "importanceScore" DOUBLE PRECISION NOT NULL,
  "confidenceScore" DOUBLE PRECISION NOT NULL,
  "sourceTrustScore" DOUBLE PRECISION NOT NULL,
  "historicalScore" DOUBLE PRECISION NOT NULL,
  "preferenceScore" DOUBLE PRECISION NOT NULL,
  "contradictionPenalty" DOUBLE PRECISION NOT NULL,
  "stalenessPenalty" DOUBLE PRECISION NOT NULL,
  "finalScore" DOUBLE PRECISION NOT NULL,
  "rank" INTEGER NOT NULL,
  "tokenCost" INTEGER NOT NULL,
  "selected" BOOLEAN NOT NULL,
  "appearedInPrompt" BOOLEAN NOT NULL DEFAULT false,
  "influencedOutput" BOOLEAN NOT NULL DEFAULT false,
  "reason" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_retrieval_trace_items_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_retrieval_trace_items_traceId_rank_idx" ON "adaptive_retrieval_trace_items"("traceId", "rank");
CREATE INDEX "adaptive_retrieval_trace_items_knowledgeObjectId_idx" ON "adaptive_retrieval_trace_items"("knowledgeObjectId");

CREATE TABLE "adaptive_source_documents" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "userId" TEXT,
  "importedByAgentId" TEXT,
  "sourceSystem" TEXT NOT NULL,
  "sourceId" TEXT NOT NULL,
  "sourceUri" TEXT,
  "originalAuthor" TEXT,
  "sourceTimestamp" TIMESTAMP(3),
  "retrievedAt" TIMESTAMP(3) NOT NULL,
  "checksum" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "accessScope" JSONB NOT NULL,
  "sensitivity" TEXT NOT NULL DEFAULT 'internal',
  "title" TEXT NOT NULL,
  "mimeType" TEXT,
  "canonicalText" TEXT NOT NULL,
  "metadata" JSONB NOT NULL DEFAULT '{}',
  "status" TEXT NOT NULL DEFAULT 'validated',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "adaptive_source_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "adaptive_source_documents_sourceSystem_sourceId_checksum_key" ON "adaptive_source_documents"("sourceSystem", "sourceId", "checksum");
CREATE INDEX "adaptive_source_documents_workspaceId_projectId_idx" ON "adaptive_source_documents"("workspaceId", "projectId");

CREATE TABLE "adaptive_source_chunks" (
  "id" TEXT NOT NULL,
  "documentId" TEXT NOT NULL,
  "ordinal" INTEGER NOT NULL,
  "content" TEXT NOT NULL,
  "checksum" TEXT NOT NULL,
  "tokenEstimate" INTEGER NOT NULL,
  "entityIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "knowledgeObjectId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_source_chunks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "adaptive_source_chunks_documentId_ordinal_key" ON "adaptive_source_chunks"("documentId", "ordinal");
CREATE INDEX "adaptive_source_chunks_checksum_idx" ON "adaptive_source_chunks"("checksum");

CREATE TABLE "adaptive_skill_candidates" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "agentId" TEXT,
  "name" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "purpose" TEXT NOT NULL,
  "triggerConditions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "prerequisites" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "inputs" JSONB NOT NULL DEFAULT '[]',
  "outputs" JSONB NOT NULL DEFAULT '[]',
  "steps" JSONB NOT NULL,
  "toolPermissions" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "approvalRequirements" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sourceRunIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "sourceEvidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "expectedSuccessCriteria" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "verificationSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "rollbackSteps" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "baselineScore" DOUBLE PRECISION,
  "candidateScore" DOUBLE PRECISION,
  "risk" DOUBLE PRECISION NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "securityFindings" JSONB NOT NULL DEFAULT '[]',
  "status" TEXT NOT NULL DEFAULT 'draft',
  "proposedBy" TEXT NOT NULL,
  "reviewedBy" TEXT,
  "reviewNote" TEXT,
  "promotedSkillId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMP(3),
  CONSTRAINT "adaptive_skill_candidates_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_skill_candidates_workspaceId_status_idx" ON "adaptive_skill_candidates"("workspaceId", "status");
CREATE INDEX "adaptive_skill_candidates_projectId_status_idx" ON "adaptive_skill_candidates"("projectId", "status");

CREATE TABLE "adaptive_skill_versions" (
  "id" TEXT NOT NULL,
  "skillId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "specification" JSONB NOT NULL,
  "evidenceIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "baselineScore" DOUBLE PRECISION,
  "evaluationScore" DOUBLE PRECISION,
  "status" TEXT NOT NULL DEFAULT 'inactive',
  "activatedAt" TIMESTAMP(3),
  "retiredAt" TIMESTAMP(3),
  "rollbackToId" TEXT,
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_skill_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "adaptive_skill_versions_skillId_version_key" ON "adaptive_skill_versions"("skillId", "version");
CREATE INDEX "adaptive_skill_versions_skillId_status_idx" ON "adaptive_skill_versions"("skillId", "status");

CREATE TABLE "adaptive_skill_replay_results" (
  "id" TEXT NOT NULL,
  "candidateId" TEXT NOT NULL,
  "fixtureName" TEXT NOT NULL,
  "dryRun" BOOLEAN NOT NULL DEFAULT true,
  "mockedWrites" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL,
  "metrics" JSONB NOT NULL,
  "failures" JSONB NOT NULL DEFAULT '[]',
  "durationMs" INTEGER,
  "cost" DOUBLE PRECISION,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_skill_replay_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_skill_replay_results_candidateId_createdAt_idx" ON "adaptive_skill_replay_results"("candidateId", "createdAt");

CREATE TABLE "adaptive_workflow_proposals" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "ownerUserId" TEXT NOT NULL,
  "operatorAgentId" TEXT,
  "trigger" JSONB NOT NULL,
  "inputs" JSONB NOT NULL,
  "tools" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "requiredCredentials" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "readScope" JSONB NOT NULL,
  "writeScope" JSONB NOT NULL,
  "approvalPoints" JSONB NOT NULL,
  "expectedOutput" JSONB NOT NULL,
  "verification" JSONB NOT NULL,
  "costEstimate" DOUBLE PRECISION,
  "runtimeEstimateMs" INTEGER,
  "failureHandling" JSONB NOT NULL,
  "rollback" JSONB NOT NULL,
  "schedule" TEXT,
  "sourceRunIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "repetitionCount" INTEGER NOT NULL,
  "confidence" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'proposed',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reviewedAt" TIMESTAMP(3),
  CONSTRAINT "adaptive_workflow_proposals_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_workflow_proposals_workspaceId_status_idx" ON "adaptive_workflow_proposals"("workspaceId", "status");

CREATE TABLE "adaptive_workflow_runs" (
  "id" TEXT NOT NULL,
  "workflowId" TEXT NOT NULL,
  "workflowVersion" INTEGER NOT NULL,
  "actingUserId" TEXT,
  "operatorAgentId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "status" TEXT NOT NULL DEFAULT 'queued',
  "retryState" TEXT,
  "credentialStatus" TEXT,
  "toolStatus" TEXT,
  "outputVerifiedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "runtimeMs" INTEGER,
  "cost" DOUBLE PRECISION,
  "error" TEXT,
  "rollbackRunId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_workflow_runs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_workflow_runs_workflowId_createdAt_idx" ON "adaptive_workflow_runs"("workflowId", "createdAt");
CREATE INDEX "adaptive_workflow_runs_workspaceId_status_idx" ON "adaptive_workflow_runs"("workspaceId", "status");

CREATE TABLE "adaptive_delegated_runs" (
  "id" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "actingUserId" TEXT,
  "mcpClientId" TEXT,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "agentId" TEXT NOT NULL,
  "objective" TEXT NOT NULL,
  "allowedTools" TEXT[],
  "maxRuntimeMs" INTEGER NOT NULL,
  "maxCost" DOUBLE PRECISION NOT NULL,
  "writePermissions" TEXT[],
  "approvalPolicy" JSONB NOT NULL,
  "expectedDeliverables" JSONB NOT NULL,
  "successCriteria" TEXT[],
  "status" TEXT NOT NULL DEFAULT 'queued',
  "cancellationRequestedAt" TIMESTAMP(3),
  "startedAt" TIMESTAMP(3),
  "completedAt" TIMESTAMP(3),
  "result" JSONB,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_delegated_runs_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "adaptive_delegated_runs_requestId_key" ON "adaptive_delegated_runs"("requestId");
CREATE INDEX "adaptive_delegated_runs_workspaceId_status_idx" ON "adaptive_delegated_runs"("workspaceId", "status");
CREATE INDEX "adaptive_delegated_runs_agentId_createdAt_idx" ON "adaptive_delegated_runs"("agentId", "createdAt");

CREATE TABLE "adaptive_mcp_clients" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "credentialHash" TEXT NOT NULL,
  "credentialPrefix" TEXT NOT NULL,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "userId" TEXT,
  "scopes" TEXT[],
  "allowedOrigins" TEXT[],
  "trustLevel" INTEGER NOT NULL DEFAULT 0,
  "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 60,
  "maxCostPerRequest" DOUBLE PRECISION,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "lastSeenAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_mcp_clients_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_mcp_clients_credentialPrefix_idx" ON "adaptive_mcp_clients"("credentialPrefix");
CREATE INDEX "adaptive_mcp_clients_workspaceId_revokedAt_idx" ON "adaptive_mcp_clients"("workspaceId", "revokedAt");

CREATE TABLE "adaptive_mcp_requests" (
  "id" TEXT NOT NULL,
  "clientId" TEXT NOT NULL,
  "requestId" TEXT NOT NULL,
  "idempotencyKey" TEXT,
  "method" TEXT NOT NULL,
  "toolName" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "status" TEXT NOT NULL,
  "requestHash" TEXT NOT NULL,
  "response" JSONB,
  "durationMs" INTEGER,
  "cost" DOUBLE PRECISION,
  "error" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_mcp_requests_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "adaptive_mcp_requests_clientId_requestId_key" ON "adaptive_mcp_requests"("clientId", "requestId");
CREATE UNIQUE INDEX "adaptive_mcp_requests_clientId_idempotencyKey_key" ON "adaptive_mcp_requests"("clientId", "idempotencyKey");
CREATE INDEX "adaptive_mcp_requests_clientId_createdAt_idx" ON "adaptive_mcp_requests"("clientId", "createdAt");

CREATE TABLE "adaptive_credential_grants" (
  "id" TEXT NOT NULL,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "tool" TEXT NOT NULL,
  "identityType" TEXT NOT NULL,
  "identityId" TEXT NOT NULL,
  "secretReference" TEXT NOT NULL,
  "scopes" TEXT[],
  "status" TEXT NOT NULL DEFAULT 'active',
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "createdBy" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_credential_grants_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_credential_grants_workspaceId_tool_status_idx" ON "adaptive_credential_grants"("workspaceId", "tool", "status");

CREATE TABLE "adaptive_events" (
  "id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "requestId" TEXT,
  "runId" TEXT,
  "userId" TEXT,
  "agentId" TEXT,
  "organizationId" TEXT,
  "workspaceId" TEXT,
  "projectId" TEXT,
  "durationMs" INTEGER,
  "tokenUsage" INTEGER,
  "cost" DOUBLE PRECISION,
  "result" TEXT,
  "error" TEXT,
  "approvalId" TEXT,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "adaptive_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "adaptive_events_type_createdAt_idx" ON "adaptive_events"("type", "createdAt");
CREATE INDEX "adaptive_events_workspaceId_createdAt_idx" ON "adaptive_events"("workspaceId", "createdAt");
CREATE INDEX "adaptive_events_runId_idx" ON "adaptive_events"("runId");

ALTER TABLE "adaptive_active_memory_snapshots"
  ADD CONSTRAINT "adaptive_active_memory_snapshots_runId_fkey"
  FOREIGN KEY ("runId") REFERENCES "neural_experiences"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "adaptive_retrieval_trace_items"
  ADD CONSTRAINT "adaptive_retrieval_trace_items_traceId_fkey"
  FOREIGN KEY ("traceId") REFERENCES "adaptive_retrieval_traces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "adaptive_source_chunks"
  ADD CONSTRAINT "adaptive_source_chunks_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "adaptive_source_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "adaptive_skill_replay_results"
  ADD CONSTRAINT "adaptive_skill_replay_results_candidateId_fkey"
  FOREIGN KEY ("candidateId") REFERENCES "adaptive_skill_candidates"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "adaptive_mcp_requests"
  ADD CONSTRAINT "adaptive_mcp_requests_clientId_fkey"
  FOREIGN KEY ("clientId") REFERENCES "adaptive_mcp_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed adaptive permissions for existing workspaces. Owners receive every new
-- permission; members receive read/proposal/internal-draft permissions only.
INSERT INTO "permissions" ("id", "workspaceId", "key", "resource", "action", "description", "createdAt")
SELECT 'adp_' || substring(md5(w."id" || p.key), 1, 20), w."id", p.key, p.resource, p.action, p.description, CURRENT_TIMESTAMP
FROM "workspaces" w
CROSS JOIN (VALUES
  ('knowledge.read','knowledge','read','Read governed knowledge and retrieval traces'),
  ('knowledge.write','knowledge','write','Submit memory and skill candidates'),
  ('knowledge.approve','knowledge','approve','Approve and roll back governed knowledge'),
  ('workflow.read','workflow','read','Read workflow proposals and health'),
  ('workflow.write','workflow','write','Propose workflow changes'),
  ('workflow.run','workflow','run','Run approved workflows'),
  ('agent.read','agent','read','Read agent capabilities and run state'),
  ('agent.delegate','agent','delegate','Create bounded delegated runs'),
  ('agent.cancel','agent','cancel','Cancel delegated runs'),
  ('agent.feedback','agent','feedback','Submit run feedback'),
  ('mcp.manage','mcp','manage','Provision and revoke MCP clients'),
  ('run.read','run','read','Read authorized run trajectories'),
  ('note.write','note','write','Create internal notes'),
  ('message.read','message','read','Read internal conversation messages'),
  ('message.write','message','write','Append internal conversation messages')
) AS p(key, resource, action, description)
ON CONFLICT ("workspaceId", "key") DO NOTHING;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT p."id", r."id" FROM "permissions" p
JOIN "roles" r ON r."workspaceId" = p."workspaceId" AND r."name" = 'Owner'
WHERE p."key" IN ('knowledge.read','knowledge.write','knowledge.approve','workflow.read','workflow.write','workflow.run','agent.read','agent.delegate','agent.cancel','agent.feedback','mcp.manage','run.read','note.write','message.read','message.write')
ON CONFLICT DO NOTHING;

INSERT INTO "_PermissionToRole" ("A", "B")
SELECT p."id", r."id" FROM "permissions" p
JOIN "roles" r ON r."workspaceId" = p."workspaceId" AND r."name" = 'Member'
WHERE p."key" IN ('knowledge.read','knowledge.write','workflow.read','workflow.write','agent.read','run.read','note.write','message.read','message.write')
ON CONFLICT DO NOTHING;
