-- Autonomy-first execution (src/lib/autonomy/). Additive only: new columns with defaults and new tables.
-- Hand-trimmed from `prisma migrate diff`; unrelated pre-existing drift deliberately excluded.

ALTER TABLE "agents" ADD COLUMN "personality" TEXT,
ADD COLUMN "specialization" TEXT,
ADD COLUMN "communicationStyle" TEXT,
ADD COLUMN "workingPreferences" JSONB NOT NULL DEFAULT '{}';

CREATE TABLE "authority_grants" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "projectId" TEXT,
    "agentId" TEXT,
    "roomId" TEXT,
    "objectiveId" TEXT,
    "operations" TEXT[],
    "capabilities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "runtimes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "budgetCents" INTEGER,
    "spentCents" INTEGER NOT NULL DEFAULT 0,
    "period" TEXT,
    "periodMaxUses" INTEGER,
    "periodStartedAt" TIMESTAMP(3),
    "periodUses" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "reason" TEXT NOT NULL DEFAULT '',
    "grantedByUserId" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "revokedByUserId" TEXT,
    "revokeReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "authority_grants_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "authority_grant_uses" (
    "id" TEXT NOT NULL,
    "grantId" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "subjectType" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "correlationId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "authority_grant_uses_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "autonomy_settings" (
    "id" TEXT NOT NULL,
    "workspaceId" TEXT NOT NULL,
    "agentId" TEXT NOT NULL DEFAULT '',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "autonomy_settings_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "prompt_compositions" (
    "id" TEXT NOT NULL,
    "hash" TEXT NOT NULL,
    "agentId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "surface" TEXT NOT NULL,
    "layers" JSONB NOT NULL,
    "sentinelText" TEXT NOT NULL,
    "totalChars" INTEGER NOT NULL,
    "sentinelChars" INTEGER NOT NULL,
    "useCount" INTEGER NOT NULL DEFAULT 1,
    "firstUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "prompt_compositions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "authority_grants_workspaceId_revokedAt_idx" ON "authority_grants"("workspaceId", "revokedAt");

CREATE INDEX "authority_grants_agentId_idx" ON "authority_grants"("agentId");

CREATE INDEX "authority_grant_uses_grantId_createdAt_idx" ON "authority_grant_uses"("grantId", "createdAt");

CREATE INDEX "authority_grant_uses_workspaceId_createdAt_idx" ON "authority_grant_uses"("workspaceId", "createdAt");

CREATE INDEX "authority_grant_uses_subjectType_subjectId_idx" ON "authority_grant_uses"("subjectType", "subjectId");

CREATE UNIQUE INDEX "autonomy_settings_workspaceId_agentId_key" ON "autonomy_settings"("workspaceId", "agentId");

CREATE UNIQUE INDEX "prompt_compositions_hash_key" ON "prompt_compositions"("hash");

CREATE INDEX "prompt_compositions_agentId_lastUsedAt_idx" ON "prompt_compositions"("agentId", "lastUsedAt");

ALTER TABLE "authority_grants" ADD CONSTRAINT "authority_grants_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "authority_grant_uses" ADD CONSTRAINT "authority_grant_uses_grantId_fkey" FOREIGN KEY ("grantId") REFERENCES "authority_grants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "autonomy_settings" ADD CONSTRAINT "autonomy_settings_workspaceId_fkey" FOREIGN KEY ("workspaceId") REFERENCES "workspaces"("id") ON DELETE CASCADE ON UPDATE CASCADE;
