import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export const MCP_SCOPES = [
  "sentinel.read",
  "sentinel.tasks.read",
  "sentinel.tasks.write",
  "sentinel.memory.read",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1_000;
const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1_000;

export function hashOpaqueSecret(value: string): string {
  return createHash("sha256").update(value).digest("base64url");
}

export function randomOpaqueSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

export function normalizeScopes(scope: string | null | undefined): McpScope[] {
  if (!scope?.trim()) return ["sentinel.read"];
  const requested = [...new Set(scope.trim().split(/\s+/))];
  if (requested.some((item) => !MCP_SCOPES.includes(item as McpScope))) {
    throw new OAuthProtocolError("invalid_scope", "One or more requested scopes are unsupported.");
  }
  return requested as McpScope[];
}

export function assertAllowedScopes(requested: McpScope[], allowed: string[]): void {
  if (requested.some((scope) => !allowed.includes(scope))) {
    throw new OAuthProtocolError("invalid_scope", "The client is not permitted to request one or more scopes.");
  }
}

export function verifyPkceS256(verifier: string, challenge: string): boolean {
  const actual = createHash("sha256").update(verifier).digest("base64url");
  const left = Buffer.from(actual);
  const right = Buffer.from(challenge);
  return left.length === right.length && timingSafeEqual(left, right);
}

export class OAuthProtocolError extends Error {
  constructor(
    public readonly code: "invalid_client" | "invalid_grant" | "invalid_request" | "invalid_scope" | "unauthorized_client",
    message: string,
  ) {
    super(message);
  }
}

export async function issueAuthorizationCode(input: {
  externalClientId: string;
  userId: string;
  redirectUri: string;
  scopes: McpScope[];
  codeChallenge: string;
}) {
  const code = randomOpaqueSecret();
  await db.oAuthAuthorizationCode.create({
    data: {
      codeHash: hashOpaqueSecret(code),
      externalClientId: input.externalClientId,
      userId: input.userId,
      redirectUri: input.redirectUri,
      scopes: input.scopes,
      codeChallenge: input.codeChallenge,
      expiresAt: new Date(Date.now() + AUTHORIZATION_CODE_TTL_MS),
    },
  });
  return code;
}

export async function exchangeAuthorizationCode(input: {
  clientId: string;
  clientSecret?: string;
  code: string;
  redirectUri: string;
  codeVerifier: string;
}) {
  const client = await db.externalClient.findUnique({ where: { clientId: input.clientId } });
  if (!client?.enabled) throw new OAuthProtocolError("invalid_client", "Unknown or disabled client.");
  if (client.clientSecretHash) {
    if (!input.clientSecret || !verifySecret(input.clientSecret, client.clientSecretHash)) {
      throw new OAuthProtocolError("invalid_client", "Client authentication failed.");
    }
  }

  const code = await db.oAuthAuthorizationCode.findUnique({ where: { codeHash: hashOpaqueSecret(input.code) } });
  if (
    !code ||
    code.externalClientId !== client.id ||
    code.redirectUri !== input.redirectUri ||
    code.usedAt ||
    code.expiresAt <= new Date() ||
    code.codeChallengeMethod !== "S256" ||
    !verifyPkceS256(input.codeVerifier, code.codeChallenge)
  ) {
    throw new OAuthProtocolError("invalid_grant", "Authorization code is invalid, expired, or already used.");
  }

  const consumed = await db.oAuthAuthorizationCode.updateMany({
    where: { id: code.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) throw new OAuthProtocolError("invalid_grant", "Authorization code was already used.");

  const token = randomOpaqueSecret(48);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  await db.oAuthAccessToken.create({
    data: {
      tokenHash: hashOpaqueSecret(token),
      externalClientId: client.id,
      userId: code.userId,
      scopes: code.scopes,
      expiresAt,
    },
  });
  return { accessToken: token, expiresAt, scopes: code.scopes };
}

export async function authenticateAccessToken(authorization: string | null) {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/);
  if (!match) return null;
  const token = await db.oAuthAccessToken.findUnique({
    where: { tokenHash: hashOpaqueSecret(match[1]) },
    include: { externalClient: true },
  });
  if (!token || token.revokedAt || token.expiresAt <= new Date() || !token.externalClient.enabled) return null;
  void db.oAuthAccessToken.update({ where: { id: token.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
  return {
    tokenId: token.id,
    externalClientId: token.externalClientId,
    userId: token.userId,
    clientId: token.externalClient.clientId,
    scopes: token.scopes as McpScope[],
  };
}

function verifySecret(value: string, expectedHash: string): boolean {
  const actual = Buffer.from(hashOpaqueSecret(value));
  const expected = Buffer.from(expectedHash);
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}
