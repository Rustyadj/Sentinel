import { NextRequest, NextResponse } from "next/server";
import { OAuthProtocolError } from "@/lib/integrations/oauth";
import { enforceRegistrationRateLimit, registerClientDynamically } from "@/lib/integrations/registration";
import { writeAuditLog } from "@/lib/workspaces/audit";

export const runtime = "nodejs";

/**
 * RFC 7591 dynamic client registration.
 *
 * Unauthenticated by specification: a client has no credentials yet, which is
 * the entire point. It is safe because registration confers nothing. The
 * client still cannot read a byte until a signed-in human approves it at
 * /api/integrations/oauth/authorize, which enforces requireUser(), PKCE S256
 * and exact redirect_uri matching, and the scopes recorded here are only a
 * ceiling on what may be consented to.
 */
export async function POST(request: NextRequest) {
  try {
    // Behind Traefik the socket address is the proxy, so the forwarded client
    // address is the only meaningful rate-limit key available here.
    const source =
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      request.headers.get("x-real-ip") ||
      "unknown";
    await enforceRegistrationRateLimit(source);

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new OAuthProtocolError("invalid_request", "Registration body must be valid JSON.");
    }

    const registration = await registerClientDynamically(body);

    await writeAuditLog({
      actorType: "system",
      action: "mcp.client.registered",
      entityType: "external_client",
      entityId: registration.client_id,
      details: {
        clientName: registration.client_name,
        redirectUris: registration.redirect_uris,
        scope: registration.scope,
        tokenEndpointAuthMethod: registration.token_endpoint_auth_method,
        source,
      },
    });

    // RFC 7591 §3.2.1: 201 with no-store.
    return NextResponse.json(registration, { status: 201, headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OAuthProtocolError) {
      return NextResponse.json(
        { error: error.code, error_description: error.message },
        { status: 400, headers: { "Cache-Control": "no-store" } },
      );
    }
    return NextResponse.json(
      { error: "server_error", error_description: "Unable to register this client." },
      { status: 500 },
    );
  }
}
