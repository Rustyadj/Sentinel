-- Control plane: where a change is, and what proves it.
--
-- Sentinel can already run git and read container state, but it has nowhere to
-- record what it saw. Every answer to "is production running main?" is derived
-- from scratch, believed for one render, and then forgotten, so it can never be
-- compared against what was true an hour ago and no claim carries its evidence.
--
-- Three of these four tables are observation logs rather than configuration. A
-- deployments row is not an instruction to deploy; it records that a SHA was
-- observed running somewhere at a time, with the evidence behind the claim.
--
-- Working-tree state is deliberately absent. A dirty file count is true for
-- seconds and cheap to observe directly; persisting it would only create a
-- second, slower, wrong answer.
--
-- Fully additive: four new tables, no existing table altered or dropped.

CREATE TABLE IF NOT EXISTS "repositories" (
    "id" TEXT NOT NULL,
    "projectId" TEXT,
    "name" TEXT NOT NULL,
    "provider" TEXT NOT NULL DEFAULT 'local',
    "remoteUrl" TEXT,
    "defaultBranch" TEXT NOT NULL DEFAULT 'main',
    "localPath" TEXT,
    "host" TEXT NOT NULL DEFAULT 'local',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "repositories_pkey" PRIMARY KEY ("id")
);

-- One row per checkout, not per path string: the same repository cloned twice
-- on one host is two working copies with genuinely different state.
CREATE UNIQUE INDEX IF NOT EXISTS "repositories_host_localPath_key" ON "repositories"("host", "localPath");
CREATE INDEX IF NOT EXISTS "repositories_projectId_idx" ON "repositories"("projectId");

CREATE TABLE IF NOT EXISTS "deployments" (
    "id" TEXT NOT NULL,
    "repositoryId" TEXT NOT NULL,
    "environment" TEXT NOT NULL,
    "sha" TEXT NOT NULL,
    "imageRef" TEXT,
    "imageDigest" TEXT,
    "containerName" TEXT,
    "status" TEXT NOT NULL DEFAULT 'unknown',
    "builtAt" TIMESTAMP(3),
    "deployedAt" TIMESTAMP(3),
    "observedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "evidence" JSONB NOT NULL DEFAULT '{}',
    CONSTRAINT "deployments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "deployments_repositoryId_environment_observedAt_idx" ON "deployments"("repositoryId", "environment", "observedAt");
CREATE INDEX IF NOT EXISTS "deployments_sha_idx" ON "deployments"("sha");

CREATE TABLE IF NOT EXISTS "health_checks" (
    "id" TEXT NOT NULL,
    "deploymentId" TEXT,
    "target" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "httpStatus" INTEGER,
    "latencyMs" INTEGER,
    "detail" TEXT,
    "checkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL DEFAULT 'probe',
    CONSTRAINT "health_checks_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "health_checks_deploymentId_checkedAt_idx" ON "health_checks"("deploymentId", "checkedAt");
CREATE INDEX IF NOT EXISTS "health_checks_target_checkedAt_idx" ON "health_checks"("target", "checkedAt");

CREATE TABLE IF NOT EXISTS "system_events" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "summary" TEXT NOT NULL,
    "actor" TEXT,
    "projectId" TEXT,
    "repositoryId" TEXT,
    "deploymentId" TEXT,
    "agentId" TEXT,
    "workspaceId" TEXT,
    "memoryId" TEXT,
    "environment" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "recordedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "source" TEXT NOT NULL,
    "dedupeKey" TEXT,
    CONSTRAINT "system_events_pkey" PRIMARY KEY ("id")
);

-- The aggregators re-scan repositories and re-read container state on a
-- schedule. Without this, every scan would re-announce the same commit.
CREATE UNIQUE INDEX IF NOT EXISTS "system_events_dedupeKey_key" ON "system_events"("dedupeKey");
CREATE INDEX IF NOT EXISTS "system_events_occurredAt_idx" ON "system_events"("occurredAt");
CREATE INDEX IF NOT EXISTS "system_events_category_occurredAt_idx" ON "system_events"("category", "occurredAt");
CREATE INDEX IF NOT EXISTS "system_events_projectId_occurredAt_idx" ON "system_events"("projectId", "occurredAt");
CREATE INDEX IF NOT EXISTS "system_events_agentId_occurredAt_idx" ON "system_events"("agentId", "occurredAt");

-- SetNull on the observation links: losing the repository a deployment was
-- observed for must not erase the record that the deployment happened.
DO $$ BEGIN
    ALTER TABLE "deployments" ADD CONSTRAINT "deployments_repositoryId_fkey"
        FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "health_checks" ADD CONSTRAINT "health_checks_deploymentId_fkey"
        FOREIGN KEY ("deploymentId") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "system_events" ADD CONSTRAINT "system_events_repositoryId_fkey"
        FOREIGN KEY ("repositoryId") REFERENCES "repositories"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "system_events" ADD CONSTRAINT "system_events_deploymentId_fkey"
        FOREIGN KEY ("deploymentId") REFERENCES "deployments"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
