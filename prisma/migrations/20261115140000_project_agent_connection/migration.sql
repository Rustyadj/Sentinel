-- What Sentinel needs to reach an agent that runs on its owner's own server
-- (origin "a2a"): its name and address as read from the Agent Card, the wire
-- dialect, a token version for re-keying, and the outcome of the last call.
-- Additive only: nullable or defaulted columns on project_agents, no backfill.

-- AlterTable
ALTER TABLE "project_agents" ADD COLUMN     "description" TEXT,
ADD COLUMN     "endpointUrl" TEXT,
ADD COLUMN     "lastCheckedAt" TIMESTAMP(3),
ADD COLUMN     "lastError" TEXT,
ADD COLUMN     "name" TEXT,
ADD COLUMN     "protocolDialect" TEXT,
ADD COLUMN     "tokenVersion" INTEGER NOT NULL DEFAULT 1;
