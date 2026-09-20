-- Memory is historical evidence, not automatically current truth.
--
-- Some facts are stable enough that a memory of them stays correct for years
-- ("Sentinel's datastore is PostgreSQL"). Others were true when recorded and
-- are worthless afterwards: a service's status, a price, which models are
-- available, whether a deployment is live. Sentinel currently treats both the
-- same way, so a nine-month-old "the gateway is healthy" is retrieved with
-- exactly the same standing as an architectural decision.
--
-- The fix is not to refuse to store volatile facts -- knowing that a price was
-- X in March is genuinely useful -- but to mark them, so retrieval can say
-- "this needs checking" and a caller with access to the authoritative source
-- can check it rather than trusting the memory.
--
-- Additive: four nullable/defaulted columns. Nothing is altered or dropped.
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "volatility" TEXT NOT NULL DEFAULT 'stable';
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "verificationPolicy" TEXT;
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "lastVerifiedAt" TIMESTAMP(3);
ALTER TABLE "memories" ADD COLUMN IF NOT EXISTS "authoritativeSource" TEXT;

CREATE INDEX IF NOT EXISTS "memories_volatility_idx" ON "memories"("volatility");
