import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";

export const MCP_SCOPES = [
  "sentinel.read",
  "sentinel.tasks.read",
  "sentinel.tasks.write",
  "sentinel.memory.read",
] as const;

export type McpScope = (typeof MCP_SCOPES)[number];

// All OAuth lifetimes live here. Access tokens stay short because they are
// bearer credentials presented on every MCP call; the refresh token is the
// long-lived half, and it rotates on every use so it is never a permanent
// credential either.
const AUTHORIZATION_CODE_TTL_MS = 5 * 60 * 1_000;
const ACCESS_TOKEN_TTL_MS = Number(process.env.MCP_ACCESS_TOKEN_TTL_MS ?? 60 * 60 * 1_000);
const REFRESH_TOKEN_TTL_MS = Number(process.env.MCP_REFRESH_TOKEN_TTL_MS ?? 30 * 24 * 60 * 60 * 1_000);

export const OAUTH_LIFETIMES = {
  authorizationCodeTtlMs: AUTHORIZATION_CODE_TTL_MS,
  accessTokenTtlMs: ACCESS_TOKEN_TTL_MS,
  refreshTokenTtlMs: REFRESH_TOKEN_TTL_MS,
} as const;

/** The grant this server implements, plus the optional refresh grant. */
export const SUPPORTED_GRANT_TYPES = ["authorization_code", "refresh_token"] as const;
export type SupportedGrantType = (typeof SUPPORTED_GRANT_TYPES)[number];

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
    public readonly code: "access_denied" | "invalid_client" | "invalid_grant" | "invalid_request" | "invalid_scope" | "invalid_target" | "unauthorized_client",
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
  resource: string;
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
      resource: input.resource,
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
  resource: string;
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
    code.resource !== input.resource ||
    !verifyPkceS256(input.codeVerifier, code.codeChallenge)
  ) {
    throw new OAuthProtocolError("invalid_grant", "Authorization code is invalid, expired, or already used.");
  }

  const consumed = await db.oAuthAuthorizationCode.updateMany({
    where: { id: code.id, usedAt: null },
    data: { usedAt: new Date() },
  });
  if (consumed.count !== 1) throw new OAuthProtocolError("invalid_grant", "Authorization code was already used.");

  return issueTokenSet({
    externalClientId: client.id,
    userId: code.userId,
    scopes: code.scopes as McpScope[],
    // A refresh token is only issued to a client that registered for the
    // refresh_token grant -- never handed out because it would be convenient.
    withRefreshToken: client.grantTypes.includes("refresh_token"),
    familyId: null,
    previousTokenId: null,
    resource: code.resource,
  });
}

export interface IssuedTokenSet {
  accessToken: string;
  expiresAt: Date;
  scopes: McpScope[];
  refreshToken?: string;
  refreshTokenExpiresAt?: Date;
}

/**
 * Mints an access token and, when the client is entitled to one, a refresh
 * token. Used by both the authorization_code and refresh_token grants so the
 * two can never drift apart in what they bind or how long they live.
 */
async function issueTokenSet(input: {
  externalClientId: string;
  userId: string;
  scopes: McpScope[];
  withRefreshToken: boolean;
  /** Null starts a new rotation family; otherwise the chain continues. */
  familyId: string | null;
  previousTokenId: string | null;
  resource: string;
}): Promise<IssuedTokenSet> {
  const accessToken = randomOpaqueSecret(48);
  const expiresAt = new Date(Date.now() + ACCESS_TOKEN_TTL_MS);
  const access = await db.oAuthAccessToken.create({
    data: {
      tokenHash: hashOpaqueSecret(accessToken),
      externalClientId: input.externalClientId,
      userId: input.userId,
      scopes: input.scopes,
      resource: input.resource,
      expiresAt,
    },
  });

  if (!input.withRefreshToken) {
    return { accessToken, expiresAt, scopes: input.scopes };
  }

  const refreshToken = randomOpaqueSecret(48);
  const refreshTokenExpiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_MS);
  const created = await db.oAuthRefreshToken.create({
    data: {
      tokenHash: hashOpaqueSecret(refreshToken),
      externalClientId: input.externalClientId,
      userId: input.userId,
      scopes: input.scopes,
      resource: input.resource,
      // A fresh consent starts its own family; cuid() is only used as a
      // convenient unique family label, never as a credential.
      familyId: input.familyId ?? `fam_${randomOpaqueSecret(16)}`,
      previousTokenId: input.previousTokenId,
      accessTokenId: access.id,
      expiresAt: refreshTokenExpiresAt,
    },
  });
  void created;

  return { accessToken, expiresAt, scopes: input.scopes, refreshToken, refreshTokenExpiresAt };
}

/**
 * Revokes every outstanding credential in a rotation family.
 *
 * Called on replay detection and on explicit revocation. Access tokens minted
 * by the family go with it, so revoking cannot leave a live bearer token
 * behind for up to an hour.
 */
export async function revokeRefreshTokenFamily(familyId: string): Promise<void> {
  const now = new Date();
  const family = await db.oAuthRefreshToken.findMany({
    where: { familyId },
    select: { accessTokenId: true },
  });
  const accessTokenIds = family.map((row) => row.accessTokenId).filter((id): id is string => Boolean(id));

  await db.$transaction([
    db.oAuthRefreshToken.updateMany({ where: { familyId, revokedAt: null }, data: { revokedAt: now } }),
    ...(accessTokenIds.length > 0
      ? [db.oAuthAccessToken.updateMany({ where: { id: { in: accessTokenIds }, revokedAt: null }, data: { revokedAt: now } })]
      : []),
  ]);
}

/** Outcome of a refresh attempt, so the route can audit precisely what happened. */
export type RefreshOutcome =
  | { kind: "rotated"; tokens: IssuedTokenSet; familyId: string; userId: string; clientId: string }
  | { kind: "replay"; familyId: string };

/**
 * The refresh_token grant.
 *
 * Rotation is unconditional: a token is single-use, and exchanging it stamps
 * rotatedAt and mints a successor in the same family. Presenting an already
 * rotated token is treated as theft -- the whole family is revoked and the
 * caller must re-consent -- because the legitimate client and an attacker
 * cannot be told apart once both hold the same token.
 */
export async function exchangeRefreshToken(input: {
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  /** Optional narrowing. Expansion is refused, never silently granted. */
  scope?: string | null;
  resource: string;
}): Promise<RefreshOutcome> {
  const client = await db.externalClient.findUnique({ where: { clientId: input.clientId } });
  if (!client?.enabled) throw new OAuthProtocolError("invalid_client", "Unknown or disabled client.");
  if (client.clientSecretHash) {
    if (!input.clientSecret || !verifySecret(input.clientSecret, client.clientSecretHash)) {
      throw new OAuthProtocolError("invalid_client", "Client authentication failed.");
    }
  }
  if (!client.grantTypes.includes("refresh_token")) {
    throw new OAuthProtocolError("unauthorized_client", "This client is not registered for the refresh_token grant.");
  }

  const stored = await db.oAuthRefreshToken.findUnique({
    where: { tokenHash: hashOpaqueSecret(input.refreshToken) },
  });
  if (!stored) throw new OAuthProtocolError("invalid_grant", "Refresh token is invalid.");
  if (stored.resource !== input.resource) {
    throw new OAuthProtocolError("invalid_target", "Refresh token is not valid for this protected resource.");
  }

  // Client binding: a token issued to one client is worthless to another, even
  // if that other client is otherwise valid.
  if (stored.externalClientId !== client.id) {
    await revokeRefreshTokenFamily(stored.familyId);
    throw new OAuthProtocolError("invalid_grant", "Refresh token was issued to a different client.");
  }

  // Replay: this token was already exchanged. Someone holds a copy.
  if (stored.rotatedAt) {
    await revokeRefreshTokenFamily(stored.familyId);
    return { kind: "replay", familyId: stored.familyId };
  }
  if (stored.revokedAt) throw new OAuthProtocolError("invalid_grant", "Refresh token has been revoked.");
  if (stored.expiresAt <= new Date()) throw new OAuthProtocolError("invalid_grant", "Refresh token has expired.");

  // Scopes may be narrowed on request, never widened past what the human
  // originally consented to.
  let scopes = stored.scopes as McpScope[];
  if (input.scope?.trim()) {
    const requested = normalizeScopes(input.scope);
    const widened = requested.filter((scope) => !scopes.includes(scope));
    if (widened.length > 0) {
      throw new OAuthProtocolError("invalid_scope", `Refresh cannot widen scope: ${widened.join(", ")}.`);
    }
    scopes = requested;
  }

  // Single-use: claim the token before minting anything. updateMany with a
  // rotatedAt: null predicate is the atomic compare-and-set, so two concurrent
  // refreshes cannot both succeed.
  const claimed = await db.oAuthRefreshToken.updateMany({
    where: { id: stored.id, rotatedAt: null, revokedAt: null },
    data: { rotatedAt: new Date(), lastUsedAt: new Date() },
  });
  if (claimed.count !== 1) {
    await revokeRefreshTokenFamily(stored.familyId);
    return { kind: "replay", familyId: stored.familyId };
  }

  const tokens = await issueTokenSet({
    externalClientId: client.id,
    userId: stored.userId,
    scopes,
    withRefreshToken: true,
    // User, client and family all carry across untouched: a refresh can never
    // change whose authority the token represents.
    familyId: stored.familyId,
    previousTokenId: stored.id,
    resource: stored.resource,
  });

  return { kind: "rotated", tokens, familyId: stored.familyId, userId: stored.userId, clientId: client.clientId };
}

export async function authenticateAccessToken(authorization: string | null, resource: string) {
  const match = authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,})$/);
  if (!match) return null;
  const token = await db.oAuthAccessToken.findUnique({
    where: { tokenHash: hashOpaqueSecret(match[1]) },
    include: { externalClient: true },
  });
  if (!token || token.resource !== resource || token.revokedAt || token.expiresAt <= new Date() || !token.externalClient.enabled) return null;
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
