import { NextRequest, NextResponse } from "next/server";
import { exchangeAuthorizationCode, OAuthProtocolError } from "@/lib/integrations/oauth";

export const runtime = "nodejs";

function oauthError(error: OAuthProtocolError | { code: "invalid_request"; message: string }) {
  return NextResponse.json({ error: error.code, error_description: error.message }, { status: 400 });
}

export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError({ code: "invalid_request", message: "Use application/x-www-form-urlencoded." });
  }
  const body = await request.formData();
  const grantType = body.get("grant_type");
  const clientId = body.get("client_id");
  const code = body.get("code");
  const redirectUri = body.get("redirect_uri");
  const codeVerifier = body.get("code_verifier");
  const clientSecret = body.get("client_secret");
  if (
    grantType !== "authorization_code" ||
    typeof clientId !== "string" ||
    typeof code !== "string" ||
    typeof redirectUri !== "string" ||
    typeof codeVerifier !== "string" ||
    (clientSecret !== null && typeof clientSecret !== "string")
  ) {
    return oauthError({ code: "invalid_request", message: "Invalid authorization-code exchange request." });
  }
  try {
    const token = await exchangeAuthorizationCode({ clientId, code, redirectUri, codeVerifier, clientSecret: clientSecret ?? undefined });
    return NextResponse.json({
      access_token: token.accessToken,
      token_type: "Bearer",
      expires_in: Math.max(0, Math.floor((token.expiresAt.getTime() - Date.now()) / 1_000)),
      scope: token.scopes.join(" "),
    }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error instanceof OAuthProtocolError) return oauthError(error);
    return NextResponse.json({ error: "server_error", error_description: "Unable to issue access token." }, { status: 500 });
  }
}
