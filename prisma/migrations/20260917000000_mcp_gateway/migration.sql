-- External MCP gateway: OAuth 2.1 client registry, one-time authorization
-- codes, and consented grants. See docs/MCP_GATEWAY.md.

CREATE TABLE "mcp_clients" (
    "clientId" TEXT NOT NULL,
    "clientSecretHash" TEXT,
    "name" TEXT NOT NULL,
    "redirectUris" TEXT[],
    "allowedScopes" TEXT[],
    "tokenEndpointAuthMethod" TEXT NOT NULL DEFAULT 'none',
    "registeredByUserId" TEXT,
    "disabledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_clients_pkey" PRIMARY KEY ("clientId")
);

CREATE TABLE "mcp_auth_codes" (
    "id" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "scopes" TEXT[],
    "redirectUri" TEXT NOT NULL,
    "codeChallenge" TEXT NOT NULL,
    "codeChallengeMethod" TEXT NOT NULL DEFAULT 'S256',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_auth_codes_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "mcp_grants" (
    "id" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "workspaceId" TEXT,
    "scopes" TEXT[],
    "refreshTokenHash" TEXT NOT NULL,
    "revokedAt" TIMESTAMP(3),
    "lastUsedAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mcp_grants_pkey" PRIMARY KEY ("id")
);

-- codeHash is UNIQUE so that consumeAuthCode()'s
-- "UPDATE ... WHERE codeHash = $1 AND consumedAt IS NULL" is an atomic
-- compare-and-set: two concurrent redemptions of the same code cannot both
-- match a row.
CREATE UNIQUE INDEX "mcp_auth_codes_codeHash_key" ON "mcp_auth_codes"("codeHash");
CREATE INDEX "mcp_auth_codes_expiresAt_idx" ON "mcp_auth_codes"("expiresAt");

CREATE UNIQUE INDEX "mcp_grants_refreshTokenHash_key" ON "mcp_grants"("refreshTokenHash");
CREATE INDEX "mcp_grants_userId_idx" ON "mcp_grants"("userId");

ALTER TABLE "mcp_auth_codes" ADD CONSTRAINT "mcp_auth_codes_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "mcp_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "mcp_grants" ADD CONSTRAINT "mcp_grants_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "mcp_clients"("clientId") ON DELETE CASCADE ON UPDATE CASCADE;
