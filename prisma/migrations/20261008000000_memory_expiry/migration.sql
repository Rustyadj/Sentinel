-- Retention is not supersession. Bot memory retention used to be stored in
-- "validTo", the bitemporal "this belief was replaced" marker, which every
-- current-truth retrieval filter reads as "superseded"; a memory kept for 30
-- days was therefore invisible from the moment it was written. Retention now has
-- its own column: NULL means it never expires.
ALTER TABLE "memories" ADD COLUMN "expiresAt" TIMESTAMP(3);

CREATE INDEX "memories_expiresAt_idx" ON "memories"("expiresAt");

-- Rows written by the previous behaviour: a bot-attributed memory with a FUTURE
-- validTo and no successor can only be a retention deadline (a real supersession
-- always records supersededById). Move it so it is readable until it expires.
UPDATE "memories"
SET "expiresAt" = "validTo", "validTo" = NULL
WHERE "source" LIKE 'bot:%'
  AND "supersededById" IS NULL
  AND "validTo" > CURRENT_TIMESTAMP;
