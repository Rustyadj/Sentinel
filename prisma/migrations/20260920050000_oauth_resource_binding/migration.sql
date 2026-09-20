-- RFC 8707 resource binding for the MCP OAuth flow. Existing credentials stay
-- nullable for a safe additive deploy; application validation deliberately
-- rejects them and requires reauthorization.
ALTER TABLE "oauth_authorization_codes" ADD COLUMN "resource" TEXT;
ALTER TABLE "oauth_access_tokens" ADD COLUMN "resource" TEXT;
ALTER TABLE "oauth_refresh_tokens" ADD COLUMN "resource" TEXT;

CREATE INDEX "oauth_access_tokens_resource_expires_idx"
  ON "oauth_access_tokens" ("resource", "expiresAt");
