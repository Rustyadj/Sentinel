-- CreateTable
CREATE TABLE "agent_workspaces" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "organizationId" TEXT,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "runtimeType" TEXT NOT NULL DEFAULT 'docker',
    "image" TEXT NOT NULL DEFAULT 'sentinel/agent-workspace:base',
    "volumeName" TEXT,
    "homePath" TEXT NOT NULL DEFAULT '/workspace',
    "resourceLimits" JSONB NOT NULL DEFAULT '{}',
    "policy" JSONB NOT NULL DEFAULT '{}',
    "locked" BOOLEAN NOT NULL DEFAULT false,
    "lastActiveAt" TIMESTAMP(3),
    "archivedAt" TIMESTAMP(3),
    "dataDeletedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_workspaces_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_workspace_runtimes" (
    "id" TEXT NOT NULL,
    "agentWorkspaceId" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'docker',
    "state" TEXT NOT NULL DEFAULT 'STOPPED',
    "containerId" TEXT,
    "containerName" TEXT,
    "image" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "destroyedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "reconciledAt" TIMESTAMP(3),
    "errorCode" TEXT,
    "errorMessage" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_workspace_runtimes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_commands" (
    "id" TEXT NOT NULL,
    "agentWorkspaceId" TEXT NOT NULL,
    "runtimeId" TEXT,
    "agentId" TEXT NOT NULL,
    "actorUserId" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'sentinel-ui',
    "command" TEXT NOT NULL,
    "cwd" TEXT,
    "status" TEXT NOT NULL DEFAULT 'running',
    "exitCode" INTEGER,
    "stdout" TEXT NOT NULL DEFAULT '',
    "stderr" TEXT NOT NULL DEFAULT '',
    "truncated" BOOLEAN NOT NULL DEFAULT false,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "durationMs" INTEGER,
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "workspace_commands_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_processes" (
    "id" TEXT NOT NULL,
    "agentWorkspaceId" TEXT NOT NULL,
    "runtimeId" TEXT,
    "agentId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "command" TEXT NOT NULL,
    "cwd" TEXT,
    "pid" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'running',
    "ports" INTEGER[] DEFAULT ARRAY[]::INTEGER[],
    "logPath" TEXT,
    "exitCode" INTEGER,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3),
    "stoppedAt" TIMESTAMP(3),
    "metadata" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "workspace_processes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_snapshots" (
    "id" TEXT NOT NULL,
    "agentWorkspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "name" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'creating',
    "storageRef" TEXT,
    "sizeBytes" BIGINT,
    "gitState" JSONB NOT NULL DEFAULT '{}',
    "fileState" JSONB NOT NULL DEFAULT '{}',
    "runtimeMetadata" JSONB NOT NULL DEFAULT '{}',
    "errorMessage" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),
    "restoredAt" TIMESTAMP(3),

    CONSTRAINT "workspace_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_permissions" (
    "id" TEXT NOT NULL,
    "agentWorkspaceId" TEXT NOT NULL,
    "granteeAgentId" TEXT,
    "granteeUserId" TEXT,
    "level" TEXT NOT NULL DEFAULT 'read',
    "grantedByUserId" TEXT,
    "reason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_artifacts" (
    "id" TEXT NOT NULL,
    "agentWorkspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "createdByUserId" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "path" TEXT NOT NULL,
    "contentType" TEXT NOT NULL DEFAULT 'application/octet-stream',
    "sizeBytes" BIGINT,
    "checksum" TEXT,
    "pinned" BOOLEAN NOT NULL DEFAULT false,
    "projectId" TEXT,
    "chatRoomId" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "workspace_artifacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "workspace_events" (
    "id" TEXT NOT NULL,
    "agentWorkspaceId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "actorUserId" TEXT,
    "actorAgentId" TEXT,
    "source" TEXT NOT NULL DEFAULT 'system',
    "message" TEXT NOT NULL,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "workspace_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "agent_workspaces_agentId_idx" ON "agent_workspaces"("agentId");

-- CreateIndex
CREATE INDEX "agent_workspaces_workspaceId_status_idx" ON "agent_workspaces"("workspaceId", "status");

-- CreateIndex
CREATE INDEX "agent_workspaces_organizationId_idx" ON "agent_workspaces"("organizationId");

-- CreateIndex
CREATE INDEX "agent_workspaces_projectId_idx" ON "agent_workspaces"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_workspaces_workspaceId_slug_key" ON "agent_workspaces"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "agent_workspace_runtimes_agentWorkspaceId_destroyedAt_idx" ON "agent_workspace_runtimes"("agentWorkspaceId", "destroyedAt");

-- CreateIndex
CREATE INDEX "agent_workspace_runtimes_state_idx" ON "agent_workspace_runtimes"("state");

-- CreateIndex
CREATE INDEX "workspace_commands_agentWorkspaceId_startedAt_idx" ON "workspace_commands"("agentWorkspaceId", "startedAt");

-- CreateIndex
CREATE INDEX "workspace_commands_status_idx" ON "workspace_commands"("status");

-- CreateIndex
CREATE INDEX "workspace_processes_agentWorkspaceId_status_idx" ON "workspace_processes"("agentWorkspaceId", "status");

-- CreateIndex
CREATE INDEX "workspace_snapshots_agentWorkspaceId_createdAt_idx" ON "workspace_snapshots"("agentWorkspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_permissions_granteeAgentId_idx" ON "workspace_permissions"("granteeAgentId");

-- CreateIndex
CREATE INDEX "workspace_permissions_granteeUserId_idx" ON "workspace_permissions"("granteeUserId");

-- CreateIndex
CREATE UNIQUE INDEX "workspace_permissions_agentWorkspaceId_granteeAgentId_grant_key" ON "workspace_permissions"("agentWorkspaceId", "granteeAgentId", "granteeUserId");

-- CreateIndex
CREATE INDEX "workspace_artifacts_agentWorkspaceId_createdAt_idx" ON "workspace_artifacts"("agentWorkspaceId", "createdAt");

-- CreateIndex
CREATE INDEX "workspace_artifacts_pinned_idx" ON "workspace_artifacts"("pinned");

-- CreateIndex
CREATE INDEX "workspace_events_agentWorkspaceId_occurredAt_idx" ON "workspace_events"("agentWorkspaceId", "occurredAt");

-- CreateIndex
CREATE INDEX "workspace_events_type_idx" ON "workspace_events"("type");

-- AddForeignKey
ALTER TABLE "agent_workspaces" ADD CONSTRAINT "agent_workspaces_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_workspace_runtimes" ADD CONSTRAINT "agent_workspace_runtimes_agentWorkspaceId_fkey" FOREIGN KEY ("agentWorkspaceId") REFERENCES "agent_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_commands" ADD CONSTRAINT "workspace_commands_agentWorkspaceId_fkey" FOREIGN KEY ("agentWorkspaceId") REFERENCES "agent_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_processes" ADD CONSTRAINT "workspace_processes_agentWorkspaceId_fkey" FOREIGN KEY ("agentWorkspaceId") REFERENCES "agent_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_snapshots" ADD CONSTRAINT "workspace_snapshots_agentWorkspaceId_fkey" FOREIGN KEY ("agentWorkspaceId") REFERENCES "agent_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_permissions" ADD CONSTRAINT "workspace_permissions_agentWorkspaceId_fkey" FOREIGN KEY ("agentWorkspaceId") REFERENCES "agent_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_artifacts" ADD CONSTRAINT "workspace_artifacts_agentWorkspaceId_fkey" FOREIGN KEY ("agentWorkspaceId") REFERENCES "agent_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "workspace_events" ADD CONSTRAINT "workspace_events_agentWorkspaceId_fkey" FOREIGN KEY ("agentWorkspaceId") REFERENCES "agent_workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

