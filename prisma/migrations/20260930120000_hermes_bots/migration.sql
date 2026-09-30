-- AlterTable
ALTER TABLE "memories" ADD COLUMN     "botId" TEXT;

-- AlterTable
ALTER TABLE "neural_skills" ADD COLUMN     "body" TEXT,
ADD COLUMN     "format" TEXT NOT NULL DEFAULT 'native',
ADD COLUMN     "reviewedAt" TIMESTAMP(3),
ADD COLUMN     "reviewedByUserId" TEXT,
ADD COLUMN     "source" JSONB NOT NULL DEFAULT '{}';

-- AlterTable
ALTER TABLE "orchestration_runs" ADD COLUMN     "botId" TEXT,
ADD COLUMN     "originKey" TEXT;

-- AlterTable
ALTER TABLE "execution_attempts" ADD COLUMN     "usage" JSONB NOT NULL DEFAULT '{}';

-- CreateTable
CREATE TABLE "bots" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "avatar" TEXT NOT NULL DEFAULT 'bot',
    "color" TEXT NOT NULL DEFAULT '#7c6cf6',
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "templateId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "mission" TEXT NOT NULL DEFAULT '',
    "responsibilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "constraints" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "outputPreferences" TEXT NOT NULL DEFAULT '',
    "workflow" JSONB NOT NULL DEFAULT '[]',
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "runtimeAgentId" TEXT NOT NULL,
    "modelConfig" JSONB NOT NULL DEFAULT '{}',
    "memoryPolicy" JSONB NOT NULL DEFAULT '{}',
    "delegationPolicy" JSONB NOT NULL DEFAULT '{}',
    "limits" JSONB NOT NULL DEFAULT '{}',
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_tool_permissions" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "serverId" TEXT NOT NULL,
    "toolName" TEXT NOT NULL DEFAULT '*',
    "permission" TEXT NOT NULL,
    "grantedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bot_tool_permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_skills" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "addedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_skills_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mcp_server_registrations" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "url" TEXT NOT NULL,
    "transport" TEXT NOT NULL DEFAULT 'streamable-http',
    "authMode" TEXT NOT NULL DEFAULT 'none',
    "secretEnvVar" TEXT,
    "capabilityTags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "tools" JSONB NOT NULL DEFAULT '[]',
    "status" TEXT NOT NULL DEFAULT 'unverified',
    "lastDiscoveredAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mcp_server_registrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bot_run_events" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "type" TEXT NOT NULL,
    "summary" TEXT NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_run_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "bots_workspaceId_status_idx" ON "bots"("workspaceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "bots_workspaceId_slug_key" ON "bots"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "bot_tool_permissions_botId_idx" ON "bot_tool_permissions"("botId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_tool_permissions_botId_serverId_toolName_key" ON "bot_tool_permissions"("botId", "serverId", "toolName");

-- CreateIndex
CREATE INDEX "bot_skills_skillId_idx" ON "bot_skills"("skillId");

-- CreateIndex
CREATE UNIQUE INDEX "bot_skills_botId_skillId_key" ON "bot_skills"("botId", "skillId");

-- CreateIndex
CREATE UNIQUE INDEX "mcp_server_registrations_workspaceId_slug_key" ON "mcp_server_registrations"("workspaceId", "slug");

-- CreateIndex
CREATE INDEX "bot_run_events_botId_occurredAt_idx" ON "bot_run_events"("botId", "occurredAt");

-- CreateIndex
CREATE UNIQUE INDEX "bot_run_events_runId_seq_key" ON "bot_run_events"("runId", "seq");

-- CreateIndex
CREATE INDEX "memories_botId_idx" ON "memories"("botId");

-- CreateIndex
CREATE INDEX "orchestration_runs_botId_createdAt_idx" ON "orchestration_runs"("botId", "createdAt");

-- AddForeignKey
ALTER TABLE "bots" ADD CONSTRAINT "bots_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_tool_permissions" ADD CONSTRAINT "bot_tool_permissions_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_skills" ADD CONSTRAINT "bot_skills_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_skills" ADD CONSTRAINT "bot_skills_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "neural_skills"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mcp_server_registrations" ADD CONSTRAINT "mcp_server_registrations_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bot_run_events" ADD CONSTRAINT "bot_run_events_botId_fkey" FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

