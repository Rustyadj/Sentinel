-- Agents people bring to a shared project, and each owner's rule for which of
-- their agents may talk to agents someone else brought. Additive only: two new
-- tables, no change to an existing one, no backfill.

-- CreateTable
CREATE TABLE "project_agents" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "ownerUserId" TEXT NOT NULL,
    "origin" TEXT NOT NULL DEFAULT 'sentinel',
    "agentCardUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'connected',
    "canReadProjectMemory" BOOLEAN NOT NULL DEFAULT true,
    "canWriteProjectMemory" BOOLEAN NOT NULL DEFAULT false,
    "canMessageOtherOwners" BOOLEAN NOT NULL DEFAULT true,
    "canUseComputer" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "project_agents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "agent_link_rules" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "peerAgentId" TEXT NOT NULL,
    "setByUserId" TEXT NOT NULL,
    "rule" TEXT NOT NULL DEFAULT 'ASK',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "agent_link_rules_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "project_agents_ownerUserId_idx" ON "project_agents"("ownerUserId");

-- CreateIndex
CREATE UNIQUE INDEX "project_agents_projectId_agentId_key" ON "project_agents"("projectId", "agentId");

-- CreateIndex
CREATE INDEX "agent_link_rules_projectId_peerAgentId_idx" ON "agent_link_rules"("projectId", "peerAgentId");

-- CreateIndex
CREATE UNIQUE INDEX "agent_link_rules_projectId_agentId_peerAgentId_key" ON "agent_link_rules"("projectId", "agentId", "peerAgentId");

-- AddForeignKey
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "project_agents" ADD CONSTRAINT "project_agents_ownerUserId_fkey" FOREIGN KEY ("ownerUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_link_rules" ADD CONSTRAINT "agent_link_rules_projectId_fkey" FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "agent_link_rules" ADD CONSTRAINT "agent_link_rules_setByUserId_fkey" FOREIGN KEY ("setByUserId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

