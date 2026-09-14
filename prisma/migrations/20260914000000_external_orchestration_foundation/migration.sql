-- CreateTable
CREATE TABLE "external_clients" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "redirectUris" TEXT[],
    "allowedScopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdByUserId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "external_clients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_authorization_codes" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "externalClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "redirectUri" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "oauth_authorization_codes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "oauth_access_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "externalClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "oauth_access_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "orchestration_runs" (
    "id" TEXT NOT NULL,
    "externalClientId" TEXT,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "projectId" TEXT,
    "parentRunId" TEXT,
    "idempotencyKey" TEXT,
    "request" JSONB NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "requestedAgentId" TEXT,
    "resolvedAgentId" TEXT,
    "routingDecision" JSONB NOT NULL DEFAULT '{}',
    "contextSnapshot" JSONB NOT NULL DEFAULT '{}',
    "retrievedObjectIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "result" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "validation" JSONB NOT NULL DEFAULT '{}',
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "orchestration_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_attempts" (
    "id" TEXT NOT NULL,
    "orchestrationRunId" TEXT NOT NULL,
    "attemptNumber" INTEGER NOT NULL,
    "agentId" TEXT NOT NULL,
    "adapterType" TEXT NOT NULL,
    "model" TEXT,
    "status" TEXT NOT NULL DEFAULT 'queued',
    "routingReason" JSONB NOT NULL DEFAULT '{}',
    "input" JSONB NOT NULL DEFAULT '{}',
    "output" JSONB NOT NULL DEFAULT '{}',
    "validation" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "cost" DOUBLE PRECISION,
    "latencyMs" INTEGER,
    "startedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "execution_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "execution_artifacts" (
    "id" TEXT NOT NULL,
    "orchestrationRunId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT,
    "storageUrl" TEXT,
    "mimeType" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "execution_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "external_clients_clientId_key" ON "external_clients"("clientId");
CREATE INDEX "external_clients_createdByUserId_idx" ON "external_clients"("createdByUserId");
CREATE UNIQUE INDEX "oauth_authorization_codes_codeHash_key" ON "oauth_authorization_codes"("codeHash");
CREATE INDEX "oauth_authorization_codes_externalClientId_expiresAt_idx" ON "oauth_authorization_codes"("externalClientId", "expiresAt");
CREATE INDEX "oauth_authorization_codes_userId_expiresAt_idx" ON "oauth_authorization_codes"("userId", "expiresAt");
CREATE UNIQUE INDEX "oauth_access_tokens_tokenHash_key" ON "oauth_access_tokens"("tokenHash");
CREATE INDEX "oauth_access_tokens_externalClientId_expiresAt_idx" ON "oauth_access_tokens"("externalClientId", "expiresAt");
CREATE INDEX "oauth_access_tokens_userId_expiresAt_idx" ON "oauth_access_tokens"("userId", "expiresAt");
CREATE UNIQUE INDEX "orchestration_runs_externalClientId_idempotencyKey_key" ON "orchestration_runs"("externalClientId", "idempotencyKey");
CREATE INDEX "orchestration_runs_userId_createdAt_idx" ON "orchestration_runs"("userId", "createdAt");
CREATE INDEX "orchestration_runs_workspaceId_createdAt_idx" ON "orchestration_runs"("workspaceId", "createdAt");
CREATE INDEX "orchestration_runs_projectId_createdAt_idx" ON "orchestration_runs"("projectId", "createdAt");
CREATE INDEX "orchestration_runs_status_queuedAt_idx" ON "orchestration_runs"("status", "queuedAt");
CREATE UNIQUE INDEX "execution_attempts_orchestrationRunId_attemptNumber_key" ON "execution_attempts"("orchestrationRunId", "attemptNumber");
CREATE INDEX "execution_attempts_agentId_createdAt_idx" ON "execution_attempts"("agentId", "createdAt");
CREATE INDEX "execution_attempts_status_createdAt_idx" ON "execution_attempts"("status", "createdAt");
CREATE INDEX "execution_artifacts_orchestrationRunId_idx" ON "execution_artifacts"("orchestrationRunId");

-- AddForeignKey
ALTER TABLE "external_clients" ADD CONSTRAINT "external_clients_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_externalClientId_fkey" FOREIGN KEY ("externalClientId") REFERENCES "external_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_authorization_codes" ADD CONSTRAINT "oauth_authorization_codes_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_externalClientId_fkey" FOREIGN KEY ("externalClientId") REFERENCES "external_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_access_tokens" ADD CONSTRAINT "oauth_access_tokens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestration_runs" ADD CONSTRAINT "orchestration_runs_externalClientId_fkey" FOREIGN KEY ("externalClientId") REFERENCES "external_clients"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestration_runs" ADD CONSTRAINT "orchestration_runs_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "orchestration_runs" ADD CONSTRAINT "orchestration_runs_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestration_runs" ADD CONSTRAINT "orchestration_runs_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "orchestration_runs" ADD CONSTRAINT "orchestration_runs_parentRunId_fkey" FOREIGN KEY ("parentRunId") REFERENCES "orchestration_runs"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "execution_attempts" ADD CONSTRAINT "execution_attempts_orchestrationRunId_fkey" FOREIGN KEY ("orchestrationRunId") REFERENCES "orchestration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "execution_artifacts" ADD CONSTRAINT "execution_artifacts_orchestrationRunId_fkey" FOREIGN KEY ("orchestrationRunId") REFERENCES "orchestration_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;
