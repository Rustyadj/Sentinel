import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import {
  assertAllowedScopes,
  issueAuthorizationCode,
  normalizeScopes,
  OAuthProtocolError,
} from "@/lib/integrations/oauth";

export const runtime = "nodejs";

function oauthErrorRedirect(redirectUri: string, state: string | null, error: OAuthProtocolError) {
  const url = new URL(redirectUri);
  url.searchParams.set("error", error.code);
  url.searchParams.set("error_description", error.message);
  if (state) url.searchParams.set("state", state);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const clientId = params.get("client_id");
  const redirectUri = params.get("redirect_uri");
  const state = params.get("state");
  const codeChallenge = params.get("code_challenge");
  const method = params.get("code_challenge_method");

  if (!clientId || !redirectUri) {
    return NextResponse.json({ error: "invalid_request", error_description: "client_id and redirect_uri are required." }, { status: 400 });
  }
  const client = await db.externalClient.findUnique({ where: { clientId } });
  if (!client?.enabled || !client.redirectUris.includes(redirectUri)) {
    return NextResponse.json({ error: "unauthorized_client", error_description: "Client or redirect URI is not registered." }, { status: 400 });
  }

  try {
    if (params.get("response_type") !== "code") {
      throw new OAuthProtocolError("invalid_request", "Only response_type=code is supported.");
    }
    if (!codeChallenge || method !== "S256") {
      throw new OAuthProtocolError("invalid_request", "PKCE S256 code_challenge is required.");
    }
    const user = await requireUser();
    const scopes = normalizeScopes(params.get("scope"));
    assertAllowedScopes(scopes, client.allowedScopes);
    const code = await issueAuthorizationCode({
      externalClientId: client.id,
      userId: user.id,
      redirectUri,
      scopes,
      codeChallenge,
    });
    const destination = new URL(redirectUri);
    destination.searchParams.set("code", code);
    if (state) destination.searchParams.set("state", state);
    return NextResponse.redirect(destination);
  } catch (error) {
    if (error instanceof OAuthProtocolError) return oauthErrorRedirect(redirectUri, state, error);
    return NextResponse.json({ error: "server_error", error_description: "Unable to authorize this client." }, { status: 500 });
  }
}
