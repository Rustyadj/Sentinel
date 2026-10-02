-- Immutable configuration checkpoints for Bot Studio rollback.
CREATE TABLE "bot_config_versions" (
    "id" TEXT NOT NULL,
    "botId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "snapshot" JSONB NOT NULL,
    "createdByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bot_config_versions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "bot_config_versions_botId_version_key" ON "bot_config_versions"("botId", "version");
CREATE INDEX "bot_config_versions_botId_createdAt_idx" ON "bot_config_versions"("botId", "createdAt");

ALTER TABLE "bot_config_versions" ADD CONSTRAINT "bot_config_versions_botId_fkey"
  FOREIGN KEY ("botId") REFERENCES "bots"("id") ON DELETE CASCADE ON UPDATE CASCADE;
