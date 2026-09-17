-- Refresh-token support for the MCP OAuth server.
--
-- Rotation model: one consent produces a chain of refresh tokens sharing a
-- familyId. Exchanging a token stamps rotatedAt on it and mints a successor.
-- Presenting an already-rotated token is a replay and revokes the family.
--
-- Additive only: no existing table is altered destructively, and existing
-- clients default to authorization_code so their behaviour is unchanged.

ALTER TABLE "external_clients"
  ADD COLUMN "grantTypes" TEXT[] DEFAULT ARRAY['authorization_code']::TEXT[];

CREATE TABLE "oauth_refresh_tokens" (
    "id" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "externalClientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "familyId" TEXT NOT NULL,
    "previousTokenId" TEXT,
    "accessTokenId" TEXT,
    "rotatedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastUsedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "oauth_refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- Unique so a presented token resolves to exactly one row, and so rotation
-- cannot accidentally create a duplicate usable credential.
CREATE UNIQUE INDEX "oauth_refresh_tokens_tokenHash_key" ON "oauth_refresh_tokens"("tokenHash");
CREATE INDEX "oauth_refresh_tokens_familyId_idx" ON "oauth_refresh_tokens"("familyId");
CREATE INDEX "oauth_refresh_tokens_externalClientId_expiresAt_idx" ON "oauth_refresh_tokens"("externalClientId", "expiresAt");
CREATE INDEX "oauth_refresh_tokens_userId_expiresAt_idx" ON "oauth_refresh_tokens"("userId", "expiresAt");

ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_externalClientId_fkey"
    FOREIGN KEY ("externalClientId") REFERENCES "external_clients"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "oauth_refresh_tokens" ADD CONSTRAINT "oauth_refresh_tokens_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
