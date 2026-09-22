/**
 * OAuth 2.1 for the external MCP gateway.
 *
 * ChatGPT (and every other MCP client) discovers this server's metadata,
 * registers itself dynamically, sends the human to /mcp/authorize for consent,
 * and exchanges a one-time code for tokens — all with PKCE and no client
 * secret required. This module is the protocol logic only: it takes a store
 * and plain inputs and returns plain results, so it is exercised directly by
 * the smoke test without a server or a database.
 *
 * Deliberate OAuth 2.1 positions:
 *  - PKCE S256 is mandatory, "plain" is rejected.
 *  - Redirect URIs match exactly; no prefix or wildcard matching.
 *  - Authorization codes are single-use, and replay revokes nothing but fails.
 *  - Refresh tokens rotate on every use.
 */
import bcrypt from "bcryptjs";
import { OAuthError } from "./errors";
import {
  ALL_SCOPES,
  DEFAULT_CLIENT_SCOPES,
  formatScopeString,
  narrowScopes,
  parseScopeString,
  type McpScope,
} from "./scopes";
import type { McpStore, StoredClient, StoredGrant } from "./store";
import {
  ACCESS_TOKEN_TTL_SECONDS,
  AUTH_CODE_TTL_SECONDS,
  REFRESH_TOKEN_TTL_SECONDS,
  hashToken,
  randomToken,
  signAccessToken,
  verifyAccessToken,
  verifyPkce,
} from "./tokens";

export function issuerUrl(): string {
  const base = process.env.MCP_GATEWAY_ISSUER ?? process.env.NEXTAUTH_URL ?? process.env.APP_URL;
  if (!base) throw new Error("MCP_GATEWAY_ISSUER (or NEXTAUTH_URL) must be set for the MCP gateway");
  return base.replace(/\/+$/, "");
}

export function authorizationServerMetadata(issuer = issuerUrl()) {
  return {
    issuer,
    authorization_endpoint: `${issuer}/mcp/authorize`,
    token_endpoint: `${issuer}/api/mcp/oauth/token`,
    registration_endpoint: `${issuer}/api/mcp/oauth/register`,
    revocation_endpoint: `${issuer}/api/mcp/oauth/revoke`,
    scopes_supported: ALL_SCOPES,
    response_types_supported: ["code"],
    grant_types_supported: ["authorization_code", "refresh_token"],
    // "none" first: public clients with PKCE are the common MCP case.
    token_endpoint_auth_methods_supported: ["none", "client_secret_post", "client_secret_basic"],
    code_challenge_methods_supported: ["S256"],
  };
}

export function protectedResourceMetadata(issuer = issuerUrl()) {
  return {
    resource: `${issuer}/api/mcp`,
    authorization_servers: [issuer],
    scopes_supported: ALL_SCOPES,
    bearer_methods_supported: ["header"],
  };
}

// --- Dynamic client registration (RFC 7591) --------------------------------

export interface RegistrationRequest {
  client_name?: unknown;
  redirect_uris?: unknown;
  scope?: unknown;
  token_endpoint_auth_method?: unknown;
}

export interface RegistrationResult {
  client_id: string;
  client_secret?: string;
  client_name: string;
  redirect_uris: string[];
  scope: string;
  token_endpoint_auth_method: string;
}

function assertUsableRedirectUri(value: string): void {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OAuthError("invalid_request", `redirect_uri is not a valid URL: ${value}`);
  }
  if (parsed.hash) throw new OAuthError("invalid_request", "redirect_uri must not contain a fragment.");
  // http is allowed only for loopback (local MCP clients); everything else
  // must be https so a code is never sent over plaintext.
  const loopback = parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new OAuthError("invalid_request", "redirect_uri must use https (http is allowed only for loopback).");
  }
}

export async function registerClient(
  store: McpStore,
  body: RegistrationRequest,
  registeredByUserId: string | null = null,
): Promise<RegistrationResult> {
  const redirectUris = Array.isArray(body.redirect_uris)
    ? body.redirect_uris.filter((uri): uri is string => typeof uri === "string")
    : [];
  if (redirectUris.length === 0) throw new OAuthError("invalid_request", "redirect_uris is required.");
  if (redirectUris.length > 10) throw new OAuthError("invalid_request", "Too many redirect_uris.");
  redirectUris.forEach(assertUsableRedirectUri);

  const requested = typeof body.scope === "string" ? parseScopeString(body.scope) : [];
  const allowedScopes = requested.length > 0 ? requested : DEFAULT_CLIENT_SCOPES;

  const authMethod = body.token_endpoint_auth_method === "client_secret_post" ? "client_secret_post" : "none";
  const clientSecret = authMethod === "none" ? null : randomToken(32);

  const client = await store.createClient({
    clientId: `mcp_${randomToken(16)}`,
    clientSecretHash: clientSecret ? await bcrypt.hash(clientSecret, 10) : null,
    name: typeof body.client_name === "string" && body.client_name.trim() ? body.client_name.trim().slice(0, 200) : "Unnamed MCP client",
    redirectUris,
    allowedScopes,
    tokenEndpointAuthMethod: authMethod,
    registeredByUserId,
  });

  return {
    client_id: client.clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    scope: formatScopeString(client.allowedScopes as McpScope[]),
    token_endpoint_auth_method: client.tokenEndpointAuthMethod,
  };
}

// --- Authorization request -------------------------------------------------

export interface AuthorizeRequest {
  clientId: string;
  redirectUri: string;
  scope: string | null;
  codeChallenge: string | null;
  codeChallengeMethod: string | null;
  state: string | null;
  resource?: string | null;
}

export interface ResolvedAuthorizeRequest {
  client: StoredClient;
  redirectUri: string;
  /** What the consent screen should offer: requested, narrowed to the client's ceiling. */
  scopes: McpScope[];
  codeChallenge: string;
  codeChallengeMethod: "S256";
  state: string | null;
  resource: string;
}

/**
 * Validates an authorization request *before* any consent UI is shown. Errors
 * here are shown to the human rather than redirected back, because an invalid
 * client_id or redirect_uri is exactly the case where we must not trust the
 * redirect target.
 */
export async function resolveAuthorizeRequest(
  store: McpStore,
  request: AuthorizeRequest,
): Promise<ResolvedAuthorizeRequest> {
  const client = await store.findClient(request.clientId);
  if (!client || client.disabledAt) throw new OAuthError("invalid_client", "Unknown or disabled client.", 401);

  if (!client.redirectUris.includes(request.redirectUri)) {
    throw new OAuthError("invalid_request", "redirect_uri does not match a registered URI for this client.");
  }
  if (request.codeChallengeMethod !== "S256" || !request.codeChallenge) {
    throw new OAuthError("invalid_request", "PKCE with code_challenge_method=S256 is required.");
  }
  const resource = `${issuerUrl()}/api/mcp`;
  if (request.resource && request.resource !== resource) {
    throw new OAuthError("invalid_request", "resource does not identify this MCP server.");
  }

  const requested = request.scope ? parseScopeString(request.scope) : (client.allowedScopes as McpScope[]);
  const scopes = narrowScopes(requested, client.allowedScopes as McpScope[]);
  if (scopes.length === 0) {
    throw new OAuthError("invalid_scope", "No requested scope is permitted for this client.");
  }

  return {
    client,
    redirectUri: request.redirectUri,
    scopes,
    codeChallenge: request.codeChallenge,
    codeChallengeMethod: "S256",
    state: request.state,
    resource,
  };
}

/**
 * Called after the human consents. `approvedScopes` is what they actually
 * ticked — never trusted to exceed the resolved request.
 */
export async function issueAuthorizationCode(
  store: McpStore,
  resolved: ResolvedAuthorizeRequest,
  consent: { userId: string; workspaceId: string | null; approvedScopes: McpScope[] },
): Promise<{ code: string; redirectTo: string }> {
  if (!consent.workspaceId) {
    throw new OAuthError("access_denied", "A workspace must be selected for this connector.");
  }
  const scopes = narrowScopes(consent.approvedScopes, resolved.scopes);
  if (scopes.length === 0) throw new OAuthError("access_denied", "No scopes were approved.");

  const code = randomToken(32);
  await store.createAuthCode({
    codeHash: hashToken(code),
    clientId: resolved.client.clientId,
    userId: consent.userId,
    workspaceId: consent.workspaceId,
    scopes,
    redirectUri: resolved.redirectUri,
    codeChallenge: resolved.codeChallenge,
    codeChallengeMethod: resolved.codeChallengeMethod,
    expiresAt: new Date(Date.now() + AUTH_CODE_TTL_SECONDS * 1000),
  });

  const redirectTo = new URL(resolved.redirectUri);
  redirectTo.searchParams.set("code", code);
  if (resolved.state) redirectTo.searchParams.set("state", resolved.state);
  return { code, redirectTo: redirectTo.toString() };
}

/** The human declined — bounce back with an error, preserving state. */
export function denialRedirect(resolved: ResolvedAuthorizeRequest): string {
  const url = new URL(resolved.redirectUri);
  url.searchParams.set("error", "access_denied");
  url.searchParams.set("error_description", "The user declined this connector.");
  if (resolved.state) url.searchParams.set("state", resolved.state);
  return url.toString();
}

// --- Token endpoint --------------------------------------------------------

export interface TokenResponse {
  access_token: string;
  token_type: "Bearer";
  expires_in: number;
  refresh_token: string;
  scope: string;
}

async function authenticateClient(
  store: McpStore,
  clientId: string | null,
  clientSecret: string | null,
): Promise<StoredClient> {
  if (!clientId) throw new OAuthError("invalid_client", "client_id is required.", 401);
  const client = await store.findClient(clientId);
  if (!client || client.disabledAt) throw new OAuthError("invalid_client", "Unknown or disabled client.", 401);

  if (client.clientSecretHash) {
    if (!clientSecret) throw new OAuthError("invalid_client", "This client must authenticate with its secret.", 401);
    if (!(await bcrypt.compare(clientSecret, client.clientSecretHash))) {
      throw new OAuthError("invalid_client", "Client authentication failed.", 401);
    }
  }
  return client;
}

async function issueTokensForGrant(store: McpStore, grant: StoredGrant): Promise<TokenResponse> {
  // Rotate: the refresh token just used (or the code just redeemed) is never
  // valid again, so a stolen refresh token is detectable as a dead token
  // rather than a silent parallel session.
  const refreshToken = randomToken(32);
  const expiresAt = new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000);
  await store.rotateRefreshToken(grant.id, hashToken(refreshToken), expiresAt);

  return {
    access_token: signAccessToken({
      sub: grant.userId,
      gid: grant.id,
      cid: grant.clientId,
      aud: `${issuerUrl()}/api/mcp`,
      scopes: grant.scopes,
      wsid: grant.workspaceId,
    }),
    token_type: "Bearer",
    expires_in: ACCESS_TOKEN_TTL_SECONDS,
    refresh_token: refreshToken,
    scope: formatScopeString(grant.scopes as McpScope[]),
  };
}

export async function exchangeAuthorizationCode(
  store: McpStore,
  params: {
    clientId: string | null;
    clientSecret: string | null;
    code: string | null;
    redirectUri: string | null;
    codeVerifier: string | null;
  },
): Promise<TokenResponse> {
  const client = await authenticateClient(store, params.clientId, params.clientSecret);
  if (!params.code) throw new OAuthError("invalid_request", "code is required.");
  if (!params.codeVerifier) throw new OAuthError("invalid_request", "code_verifier is required.");

  const stored = await store.consumeAuthCode(hashToken(params.code));
  // Consumed atomically above, so a replay lands here as "unknown code".
  if (!stored) throw new OAuthError("invalid_grant", "Authorization code is invalid or already used.");
  if (stored.clientId !== client.clientId) {
    throw new OAuthError("invalid_grant", "Authorization code was issued to a different client.");
  }
  if (stored.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "Authorization code expired.");
  if (params.redirectUri && params.redirectUri !== stored.redirectUri) {
    throw new OAuthError("invalid_grant", "redirect_uri does not match the authorization request.");
  }
  if (!verifyPkce(params.codeVerifier, stored.codeChallenge, stored.codeChallengeMethod)) {
    throw new OAuthError("invalid_grant", "PKCE verification failed.");
  }

  const grant = await store.createGrant({
    clientId: stored.clientId,
    userId: stored.userId,
    workspaceId: stored.workspaceId,
    scopes: stored.scopes,
    // Replaced immediately by issueTokensForGrant's rotation; never issued.
    refreshTokenHash: hashToken(randomToken(32)),
    expiresAt: new Date(Date.now() + REFRESH_TOKEN_TTL_SECONDS * 1000),
  });

  return issueTokensForGrant(store, grant);
}

export async function exchangeRefreshToken(
  store: McpStore,
  params: { clientId: string | null; clientSecret: string | null; refreshToken: string | null },
): Promise<TokenResponse> {
  const client = await authenticateClient(store, params.clientId, params.clientSecret);
  if (!params.refreshToken) throw new OAuthError("invalid_request", "refresh_token is required.");

  const grant = await store.findGrantByRefreshHash(hashToken(params.refreshToken));
  if (!grant || grant.revokedAt) throw new OAuthError("invalid_grant", "Refresh token is invalid or revoked.");
  if (grant.clientId !== client.clientId) {
    throw new OAuthError("invalid_grant", "Refresh token was issued to a different client.");
  }
  if (grant.expiresAt.getTime() < Date.now()) throw new OAuthError("invalid_grant", "Refresh token expired.");

  return issueTokensForGrant(store, grant);
}

// --- Resource-server side --------------------------------------------------

export interface McpPrincipal {
  userId: string;
  clientId: string;
  grantId: string;
  workspaceId: string | null;
  scopes: string[];
}

/**
 * Resolves the bearer token on an MCP request. The token's scopes are
 * intersected with the grant's current scopes, so narrowing a grant takes
 * effect immediately rather than at the next token refresh.
 */
export async function authenticateBearer(store: McpStore, authorization: string | null): Promise<McpPrincipal | null> {
  if (!authorization?.startsWith("Bearer ")) return null;
  const payload = verifyAccessToken(authorization.slice("Bearer ".length).trim(), `${issuerUrl()}/api/mcp`);
  if (!payload) return null;

  const grant = await store.findGrant(payload.gid);
  if (!grant || grant.revokedAt) return null;
  if (grant.expiresAt.getTime() < Date.now()) return null;
  if (grant.userId !== payload.sub || grant.clientId !== payload.cid) return null;

  return {
    userId: grant.userId,
    clientId: grant.clientId,
    grantId: grant.id,
    workspaceId: grant.workspaceId,
    scopes: payload.scopes.filter((scope) => grant.scopes.includes(scope)),
  };
}

/**
 * RFC 9728 challenge. Returning the resource-metadata pointer is what lets an
 * MCP client discover where to authenticate instead of just failing.
 */
export function unauthorizedResponse(description = "Authentication required."): Response {
  let metadataUrl: string;
  try {
    metadataUrl = `${issuerUrl()}/.well-known/oauth-protected-resource`;
  } catch {
    metadataUrl = "/.well-known/oauth-protected-resource";
  }
  return Response.json(
    { error: "invalid_token", error_description: description },
    {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${metadataUrl}", error="invalid_token", error_description="${description}"`,
      },
    },
  );
}
