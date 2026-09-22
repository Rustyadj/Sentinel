/**
 * Persistence seam for the MCP gateway.
 *
 * The OAuth logic is pure protocol — PKCE, one-time codes, scope narrowing,
 * revocation — and none of it should need Postgres to be exercised. Defining
 * the four records it needs as an interface lets the end-to-end smoke test run
 * the real authorize/token/tools path in-process against an in-memory store,
 * while production runs the identical code against Prisma.
 */
import type { PrismaClient } from "@prisma/client";
import type { McpScope } from "./scopes";

/**
 * Exactly the three delegates this module touches. Narrowing PrismaClient
 * rather than redeclaring the shape keeps the store honest against the schema.
 */
export type PrismaLike = Pick<PrismaClient, "mcpClient" | "mcpAuthCode" | "mcpGrant">;

export interface StoredClient {
  clientId: string;
  clientSecretHash: string | null;
  name: string;
  redirectUris: string[];
  allowedScopes: string[];
  tokenEndpointAuthMethod: string;
  registeredByUserId: string | null;
  disabledAt: Date | null;
}

export interface StoredAuthCode {
  id: string;
  codeHash: string;
  clientId: string;
  userId: string;
  workspaceId: string | null;
  scopes: string[];
  redirectUri: string;
  codeChallenge: string;
  codeChallengeMethod: string;
  expiresAt: Date;
  consumedAt: Date | null;
}

export interface StoredGrant {
  id: string;
  clientId: string;
  userId: string;
  workspaceId: string | null;
  scopes: string[];
  refreshTokenHash: string;
  revokedAt: Date | null;
  expiresAt: Date;
}

export interface McpStore {
  createClient(input: Omit<StoredClient, "disabledAt">): Promise<StoredClient>;
  findClient(clientId: string): Promise<StoredClient | null>;

  createAuthCode(input: Omit<StoredAuthCode, "id" | "consumedAt">): Promise<StoredAuthCode>;
  /**
   * Atomically marks the code consumed and returns it. Returns null when the
   * code is unknown or was already redeemed — replay must fail, and the check
   * and the write cannot be two steps or two concurrent redemptions both win.
   */
  consumeAuthCode(codeHash: string): Promise<StoredAuthCode | null>;

  createGrant(input: Omit<StoredGrant, "id" | "revokedAt">): Promise<StoredGrant>;
  findGrant(id: string): Promise<StoredGrant | null>;
  findGrantByRefreshHash(hash: string): Promise<StoredGrant | null>;
  rotateRefreshToken(id: string, refreshTokenHash: string, expiresAt: Date): Promise<StoredGrant | null>;
  revokeGrant(id: string): Promise<void>;
  listGrantsForUser(userId: string): Promise<StoredGrant[]>;
}

/** Live store, backed by the McpClient / McpAuthCode / McpGrant models. */
export function prismaStore(db: PrismaLike): McpStore {
  return {
    async createClient(input) {
      return db.mcpClient.create({ data: { ...input } }) as Promise<StoredClient>;
    },
    async findClient(clientId) {
      return db.mcpClient.findUnique({ where: { clientId } }) as Promise<StoredClient | null>;
    },
    async createAuthCode(input) {
      return db.mcpAuthCode.create({ data: { ...input } }) as Promise<StoredAuthCode>;
    },
    async consumeAuthCode(codeHash) {
      // updateMany with a consumedAt: null predicate is the atomic
      // compare-and-set: a second redemption matches zero rows.
      const claimed = await db.mcpAuthCode.updateMany({
        where: { codeHash, consumedAt: null },
        data: { consumedAt: new Date() },
      });
      if (claimed.count === 0) return null;
      return db.mcpAuthCode.findUnique({ where: { codeHash } }) as Promise<StoredAuthCode | null>;
    },
    async createGrant(input) {
      return db.mcpGrant.create({ data: { ...input } }) as Promise<StoredGrant>;
    },
    async findGrant(id) {
      return db.mcpGrant.findUnique({ where: { id } }) as Promise<StoredGrant | null>;
    },
    async findGrantByRefreshHash(refreshTokenHash) {
      return db.mcpGrant.findUnique({ where: { refreshTokenHash } }) as Promise<StoredGrant | null>;
    },
    async rotateRefreshToken(id, refreshTokenHash, expiresAt) {
      return db.mcpGrant.update({
        where: { id },
        data: { refreshTokenHash, expiresAt, lastUsedAt: new Date() },
      }) as Promise<StoredGrant | null>;
    },
    async revokeGrant(id) {
      await db.mcpGrant.update({ where: { id }, data: { revokedAt: new Date() } });
    },
    async listGrantsForUser(userId) {
      return db.mcpGrant.findMany({
        where: { userId, revokedAt: null },
        orderBy: { createdAt: "desc" },
      }) as Promise<StoredGrant[]>;
    },
  };
}

/** In-memory store for tests and local probes. Never used in production. */
export function memoryStore(): McpStore {
  const clients = new Map<string, StoredClient>();
  const codes = new Map<string, StoredAuthCode>();
  const grants = new Map<string, StoredGrant>();
  let seq = 0;
  const nextId = (prefix: string) => `${prefix}_${++seq}`;

  return {
    async createClient(input) {
      const client: StoredClient = { ...input, disabledAt: null };
      clients.set(client.clientId, client);
      return client;
    },
    async findClient(clientId) {
      return clients.get(clientId) ?? null;
    },
    async createAuthCode(input) {
      const code: StoredAuthCode = { ...input, id: nextId("code"), consumedAt: null };
      codes.set(code.codeHash, code);
      return code;
    },
    async consumeAuthCode(codeHash) {
      const code = codes.get(codeHash);
      if (!code || code.consumedAt) return null;
      code.consumedAt = new Date();
      return code;
    },
    async createGrant(input) {
      const grant: StoredGrant = { ...input, id: nextId("grant"), revokedAt: null };
      grants.set(grant.id, grant);
      return grant;
    },
    async findGrant(id) {
      return grants.get(id) ?? null;
    },
    async findGrantByRefreshHash(hash) {
      return [...grants.values()].find((grant) => grant.refreshTokenHash === hash) ?? null;
    },
    async rotateRefreshToken(id, refreshTokenHash, expiresAt) {
      const grant = grants.get(id);
      if (!grant) return null;
      grant.refreshTokenHash = refreshTokenHash;
      grant.expiresAt = expiresAt;
      return grant;
    },
    async revokeGrant(id) {
      const grant = grants.get(id);
      if (grant) grant.revokedAt = new Date();
    },
    async listGrantsForUser(userId) {
      return [...grants.values()].filter((grant) => grant.userId === userId && !grant.revokedAt);
    },
  };
}

export type { McpScope };
