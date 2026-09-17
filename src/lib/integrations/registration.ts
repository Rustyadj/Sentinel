import { db } from "@/lib/db";
import { redisIncrementWithExpiry } from "@/lib/redis";
import {
  MCP_SCOPES,
  OAuthProtocolError,
  hashOpaqueSecret,
  randomOpaqueSecret,
  type McpScope,
} from "./oauth";

/**
 * RFC 7591 dynamic client registration for the Sentinel MCP gateway.
 *
 * Added because a real ChatGPT/Codex connection attempt proved it necessary,
 * not on principle. Packet capture of the Authenticate click shows the client
 * walking discovery cleanly -- GET /api/mcp 401, protected resource metadata
 * 200, authorization server metadata 200 -- and then stopping without ever
 * issuing an authorization request. It had no way to obtain a client_id: the
 * metadata advertised no registration_endpoint, no Client ID Metadata Document
 * support, and no static credentials were configured. All three registration
 * mechanisms the MCP authorization spec defines were closed.
 *
 * Registration deliberately grants nothing. A registered client holds no
 * authority at all until a signed-in human approves it at
 * /api/integrations/oauth/authorize, which still calls requireUser(), still
 * demands PKCE S256, and still matches redirect_uri exactly. The scopes named
 * here are only a ceiling on what may later be consented to.
 */

/** Same shape RFC 7591 §3.2.1 defines for a registration response. */
export interface ClientRegistrationResponse {
  client_id: string;
  client_secret?: string;
  client_id_issued_at: number;
  client_secret_expires_at?: number;
  client_name: string;
  redirect_uris: string[];
  grant_types: string[];
  response_types: string[];
  token_endpoint_auth_method: string;
  scope: string;
}

const MAX_REDIRECT_URIS = 5;
const MAX_NAME_LENGTH = 200;

/**
 * Registration is unauthenticated, so it is rate limited per source address.
 * Without this, an open endpoint that writes a database row is a trivial way
 * to fill the table.
 */
export async function enforceRegistrationRateLimit(sourceKey: string): Promise<void> {
  const windowSeconds = 60 * 60;
  const maxRegistrations = Number(process.env.MCP_REGISTRATION_LIMIT_PER_HOUR ?? "20");
  const window = Math.floor(Date.now() / (windowSeconds * 1_000));
  const count = await redisIncrementWithExpiry(`mcp:register:${sourceKey}:${window}`, windowSeconds + 1);
  if (count === null) throw new OAuthProtocolError("invalid_request", "Registration is temporarily unavailable.");
  if (count > maxRegistrations) {
    throw new OAuthProtocolError("invalid_request", "Too many client registrations from this source.");
  }
}

/**
 * Redirect URIs are the one field that must be airtight: it is where an
 * authorization code is delivered. Exact-match only -- no wildcards, no
 * prefixes, no fragments, and https except on loopback for local clients.
 */
function assertUsableRedirectUri(value: string): void {
  if (value.includes("*")) {
    throw new OAuthProtocolError("invalid_request", "Wildcard redirect URIs are not permitted.");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new OAuthProtocolError("invalid_request", `redirect_uri is not a valid absolute URL: ${value}`);
  }
  if (parsed.hash) {
    throw new OAuthProtocolError("invalid_request", "redirect_uri must not contain a fragment.");
  }
  const loopback =
    parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1" || parsed.hostname === "[::1]" || parsed.hostname === "::1";
  if (parsed.protocol !== "https:" && !(parsed.protocol === "http:" && loopback)) {
    throw new OAuthProtocolError(
      "invalid_request",
      "redirect_uri must use https; http is permitted only for loopback addresses.",
    );
  }
}

function readStringArray(value: unknown, field: string): string[] {
  if (!Array.isArray(value)) throw new OAuthProtocolError("invalid_request", `${field} must be an array of strings.`);
  const entries = value.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
  if (entries.length !== value.length) {
    throw new OAuthProtocolError("invalid_request", `${field} must contain only non-empty strings.`);
  }
  return entries;
}

export async function registerClientDynamically(body: unknown): Promise<ClientRegistrationResponse> {
  if (typeof body !== "object" || body === null) {
    throw new OAuthProtocolError("invalid_request", "Registration body must be a JSON object.");
  }
  const request = body as Record<string, unknown>;

  const redirectUris = readStringArray(request.redirect_uris, "redirect_uris");
  if (redirectUris.length === 0) {
    throw new OAuthProtocolError("invalid_request", "redirect_uris is required and must not be empty.");
  }
  if (redirectUris.length > MAX_REDIRECT_URIS) {
    throw new OAuthProtocolError("invalid_request", `At most ${MAX_REDIRECT_URIS} redirect_uris may be registered.`);
  }
  redirectUris.forEach(assertUsableRedirectUri);

  // Only the authorization_code grant exists on this server; a client asking
  // for anything else is told plainly rather than silently downgraded.
  if (request.grant_types !== undefined) {
    const grantTypes = readStringArray(request.grant_types, "grant_types");
    const unsupported = grantTypes.filter((grant) => grant !== "authorization_code");
    if (unsupported.length > 0) {
      throw new OAuthProtocolError(
        "invalid_request",
        `Unsupported grant_types: ${unsupported.join(", ")}. Only authorization_code is available.`,
      );
    }
  }
  if (request.response_types !== undefined) {
    const responseTypes = readStringArray(request.response_types, "response_types");
    const unsupported = responseTypes.filter((type) => type !== "code");
    if (unsupported.length > 0) {
      throw new OAuthProtocolError("invalid_request", `Unsupported response_types: ${unsupported.join(", ")}.`);
    }
  }

  // Scopes are clamped to the registered MCP scope set. An unknown scope is
  // rejected rather than dropped, so a client never believes it holds more
  // than it does. Omitting scope means "the full advertised set", matching
  // scopes_supported -- still only a ceiling, since the human consents later.
  let allowedScopes: McpScope[];
  if (typeof request.scope === "string" && request.scope.trim()) {
    const requested = [...new Set(request.scope.trim().split(/\s+/))];
    const unknown = requested.filter((scope) => !MCP_SCOPES.includes(scope as McpScope));
    if (unknown.length > 0) {
      throw new OAuthProtocolError("invalid_scope", `Unsupported scope(s): ${unknown.join(", ")}.`);
    }
    allowedScopes = requested as McpScope[];
  } else {
    allowedScopes = [...MCP_SCOPES];
  }

  // "none" makes a public client that proves itself with PKCE alone, which is
  // what most MCP clients use. Anything else gets a secret.
  const authMethod = request.token_endpoint_auth_method === "none" ? "none" : "client_secret_post";
  const clientSecret = authMethod === "none" ? null : randomOpaqueSecret();

  const rawName = typeof request.client_name === "string" ? request.client_name.trim() : "";
  const name = (rawName || "Dynamically registered MCP client").slice(0, MAX_NAME_LENGTH);

  const client = await db.externalClient.create({
    data: {
      clientId: `dcr-${randomOpaqueSecret(16)}`,
      name,
      clientSecretHash: clientSecret ? hashOpaqueSecret(clientSecret) : null,
      redirectUris,
      allowedScopes,
      enabled: true,
      createdByUserId: null,
    },
  });

  return {
    client_id: client.clientId,
    ...(clientSecret ? { client_secret: clientSecret } : {}),
    client_id_issued_at: Math.floor(client.createdAt.getTime() / 1_000),
    // 0 means the secret does not expire (RFC 7591 §3.2.1).
    ...(clientSecret ? { client_secret_expires_at: 0 } : {}),
    client_name: client.name,
    redirect_uris: client.redirectUris,
    grant_types: ["authorization_code"],
    response_types: ["code"],
    token_endpoint_auth_method: authMethod,
    scope: allowedScopes.join(" "),
  };
}
