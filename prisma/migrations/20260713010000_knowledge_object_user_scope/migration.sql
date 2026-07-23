-- Tie graph objects to the authenticated Sentinel user while preserving
-- existing project-scoped records for migration/backfill.
ALTER TABLE "users" ADD COLUMN IF NOT EXISTS "passwordHash" TEXT;

ALTER TABLE "knowledge_objects" ADD COLUMN "userId" TEXT;

CREATE UNIQUE INDEX "knowledge_objects_sourceType_sourceId_userId_key"
ON "knowledge_objects"("sourceType", "sourceId", "userId");

CREATE INDEX "knowledge_objects_userId_idx" ON "knowledge_objects"("userId");

ALTER TABLE "knowledge_objects"
ADD CONSTRAINT "knowledge_objects_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id")
ON DELETE CASCADE ON UPDATE CASCADE;
