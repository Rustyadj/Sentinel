-- Canonical persistent computer per agent. A partial unique index expresses
-- the invariant PostgreSQL can enforce: at most one true value per agent.
ALTER TABLE "agent_workspaces" ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false;

CREATE UNIQUE INDEX "agent_workspaces_one_default_per_agent_key"
  ON "agent_workspaces"("agentId")
  WHERE "isDefault" = true;
