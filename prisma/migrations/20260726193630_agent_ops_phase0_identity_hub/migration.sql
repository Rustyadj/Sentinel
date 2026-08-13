-- CreateTable
CREATE TABLE "agent_configurations" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "model" TEXT NOT NULL DEFAULT 'claude-sonnet-4-6',
    "systemPrompt" TEXT NOT NULL DEFAULT '',
    "temperature" DOUBLE PRECISION NOT NULL DEFAULT 0.7,
    "reasoningMode" TEXT NOT NULL DEFAULT 'standard',
    "memoryScope" TEXT NOT NULL DEFAULT 'session',
    "workspaceAccess" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedTools" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowedMcpServers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "budgets" JSONB NOT NULL DEFAULT '{}',
    "rateLimits" JSONB NOT NULL DEFAULT '{}',
    "instructionFiles" JSONB NOT NULL DEFAULT '{}',
    "promptHistory" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_configurations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_instances" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "provider" TEXT,
    "authMode" TEXT,
    "model" TEXT,
    "endpoint" TEXT,
    "configPath" TEXT,
    "logPath" TEXT,
    "dashboardPort" INTEGER,
    "legacyPath" TEXT,
    "vpsWorkspaceTag" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_health_checks" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "instanceId" TEXT,
    "status" TEXT NOT NULL,
    "latencyMs" INTEGER,
    "details" JSONB NOT NULL DEFAULT '{}',
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_health_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_events" (
    "id" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "agent_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "agent_configurations_agentId_key" ON "agent_configurations"("agentId");

-- CreateIndex
CREATE INDEX "agent_instances_agentId_idx" ON "agent_instances"("agentId");

-- CreateIndex
CREATE INDEX "agent_health_checks_agentId_checkedAt_idx" ON "agent_health_checks"("agentId", "checkedAt");

-- CreateIndex
CREATE INDEX "agent_events_agentId_createdAt_idx" ON "agent_events"("agentId", "createdAt");

-- AddForeignKey
ALTER TABLE "agent_configurations" ADD CONSTRAINT "agent_configurations_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_instances" ADD CONSTRAINT "agent_instances_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_health_checks" ADD CONSTRAINT "agent_health_checks_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_events" ADD CONSTRAINT "agent_events_agentId_fkey" FOREIGN KEY ("agentId") REFERENCES "agents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
