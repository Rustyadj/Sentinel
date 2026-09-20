import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import {
  assertAllowedScopes,
  issueAuthorizationCode,
  normalizeScopes,
  OAuthProtocolError,
  type McpScope,
} from "@/lib/integrations/oauth";
import { publicOrigin } from "@/lib/integrations/public-origin";
import { writeAuditLog } from "@/lib/workspaces/audit";

export const runtime = "nodejs";

interface AuthorizationRequest {
  clientId: string;
  redirectUri: string;
  state: string | null;
  codeChallenge: string;
  scopes: McpScope[];
  resource: string;
  client: { id: string; name: string; allowedScopes: string[] };
}

const SCOPE_LABELS: Record<McpScope, string> = {
  "sentinel.read": "Read permitted Sentinel context and agent status",
  "sentinel.memory.read": "Search permitted Sentinel memory",
  "sentinel.tasks.read": "Read the status and verified result of your Sentinel tasks",
  "sentinel.tasks.write": "Route and cancel work through Sentinel agents",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;",
  })[character] ?? character);
}

function oauthErrorRedirect(request: AuthorizationRequest, error: OAuthProtocolError) {
  const url = new URL(request.redirectUri);
  url.searchParams.set("error", error.code);
  url.searchParams.set("error_description", error.message);
  if (request.state) url.searchParams.set("state", request.state);
  return NextResponse.redirect(url);
}

async function resolveAuthorizationRequest(
  request: NextRequest,
  read: (key: string) => string | null,
): Promise<AuthorizationRequest> {
  const clientId = read("client_id");
  const redirectUri = read("redirect_uri");
  const codeChallenge = read("code_challenge");
  if (!clientId || !redirectUri) {
    throw new OAuthProtocolError("invalid_request", "client_id and redirect_uri are required.");
  }
  const client = await db.externalClient.findUnique({ where: { clientId } });
  if (!client?.enabled || !client.redirectUris.includes(redirectUri)) {
    throw new OAuthProtocolError("unauthorized_client", "Client or redirect URI is not registered.");
  }
  if (read("response_type") !== "code") {
    throw new OAuthProtocolError("invalid_request", "Only response_type=code is supported.");
  }
  if (!codeChallenge || read("code_challenge_method") !== "S256") {
    throw new OAuthProtocolError("invalid_request", "PKCE S256 code_challenge is required.");
  }
  const resource = read("resource");
  const expectedResource = `${publicOrigin(request)}/api/mcp`;
  if (!resource || resource !== expectedResource) {
    throw new OAuthProtocolError("invalid_target", `resource must be ${expectedResource}.`);
  }
  const scopes = normalizeScopes(read("scope"));
  assertAllowedScopes(scopes, client.allowedScopes);
  return {
    clientId,
    redirectUri,
    state: read("state"),
    codeChallenge,
    scopes,
    resource,
    client: { id: client.id, name: client.name, allowedScopes: client.allowedScopes },
  };
}

function invalidRequest(error: unknown) {
  const protocol = error instanceof OAuthProtocolError
    ? error
    : new OAuthProtocolError("invalid_request", "Invalid authorization request.");
  return NextResponse.json(
    { error: protocol.code, error_description: protocol.message },
    { status: protocol.code === "unauthorized_client" ? 401 : 400, headers: { "Cache-Control": "no-store" } },
  );
}

export async function GET(request: NextRequest) {
  try {
    const resolved = await resolveAuthorizationRequest(request, (key) => request.nextUrl.searchParams.get(key));
    const user = await requireUser();
    const hidden = [
      ["client_id", resolved.clientId], ["redirect_uri", resolved.redirectUri], ["response_type", "code"],
      ["code_challenge", resolved.codeChallenge], ["code_challenge_method", "S256"],
      ["scope", resolved.scopes.join(" ")], ["resource", resolved.resource],
      ...(resolved.state ? [["state", resolved.state]] : []),
    ].map(([name, value]) => `<input type="hidden" name="${name}" value="${escapeHtml(value)}">`).join("");
    const scopeRows = resolved.scopes.map((scope) => `
      <label><input type="checkbox" name="approved_scope" value="${scope}" checked>
      <span><strong>${escapeHtml(SCOPE_LABELS[scope])}</strong><small>${scope}</small></span></label>`).join("");
    const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
      <title>Authorize ${escapeHtml(resolved.client.name)} · Sentinel</title>
      <style>body{margin:0;background:#0b1020;color:#eef2ff;font:16px system-ui;display:grid;min-height:100vh;place-items:center}.card{width:min(560px,calc(100% - 40px));background:#121a2d;border:1px solid #2b3757;border-radius:18px;padding:28px;box-sizing:border-box}h1{font-size:22px;margin:0 0 8px}p{color:#aeb9d4;line-height:1.5}fieldset{border:0;padding:0;margin:24px 0}label{display:flex;gap:12px;padding:12px 0;border-top:1px solid #27324e}small{display:block;color:#8996b4;margin-top:4px}.actions{display:flex;gap:12px}.actions button{flex:1;padding:11px;border-radius:9px;border:1px solid #435174;background:#19233a;color:#eef2ff;font-weight:650}.actions .approve{background:#6475ee;border-color:#6475ee;color:white}</style></head>
      <body><main class="card"><h1>Connect ${escapeHtml(resolved.client.name)} to Sentinel?</h1>
      <p>Signed in as ${escapeHtml(user.email)}. This client will act as this exact Sentinel identity and receive only the permissions you approve below.</p>
      <form method="post">${hidden}<fieldset>${scopeRows}</fieldset><div class="actions"><button name="decision" value="deny">Deny</button><button class="approve" name="decision" value="approve">Approve</button></div></form></main></body></html>`;
    return new NextResponse(html, {
      headers: {
        "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store",
        "Content-Security-Policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
      },
    });
  } catch (error) {
    return invalidRequest(error);
  }
}

export async function POST(request: NextRequest) {
  let resolved: AuthorizationRequest | null = null;
  try {
    const origin = request.headers.get("origin");
    if (origin && origin !== publicOrigin(request)) {
      throw new OAuthProtocolError("invalid_request", "Authorization form origin is invalid.");
    }
    const form = await request.formData();
    const read = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" && value.length > 0 ? value : null;
    };
    resolved = await resolveAuthorizationRequest(request, read);
    const user = await requireUser();
    if (read("decision") !== "approve") {
      await writeAuditLog({
        userId: user.id, actorType: "user", action: "mcp.consent.denied",
        entityType: "external_client", entityId: resolved.client.id,
        details: { clientId: resolved.clientId, scopes: resolved.scopes, resource: resolved.resource },
      });
      return oauthErrorRedirect(resolved, new OAuthProtocolError("access_denied", "The user denied the authorization request."));
    }
    const approved = form.getAll("approved_scope").filter((value): value is string => typeof value === "string");
    const scopes = normalizeScopes(approved.join(" "));
    if (approved.length === 0 || scopes.some((scope) => !resolved!.scopes.includes(scope))) {
      throw new OAuthProtocolError("invalid_scope", "Approve at least one requested scope; unrequested scopes cannot be added.");
    }
    const code = await issueAuthorizationCode({
      externalClientId: resolved.client.id, userId: user.id, redirectUri: resolved.redirectUri,
      scopes, codeChallenge: resolved.codeChallenge, resource: resolved.resource,
    });
    await writeAuditLog({
      userId: user.id, actorType: "user", action: "mcp.consent.approved",
      entityType: "external_client", entityId: resolved.client.id,
      details: { clientId: resolved.clientId, scopes, resource: resolved.resource },
    });
    const destination = new URL(resolved.redirectUri);
    destination.searchParams.set("code", code);
    if (resolved.state) destination.searchParams.set("state", resolved.state);
    return NextResponse.redirect(destination, 303);
  } catch (error) {
    if (resolved && error instanceof OAuthProtocolError) return oauthErrorRedirect(resolved, error);
    return invalidRequest(error);
  }
}
