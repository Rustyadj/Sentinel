import { NextRequest, NextResponse } from "next/server";
import {
  exchangeAuthorizationCode,
  exchangeRefreshToken,
  OAuthProtocolError,
} from "@/lib/integrations/oauth";
import { writeAuditLog } from "@/lib/workspaces/audit";
import { publicOrigin } from "@/lib/integrations/public-origin";

export const runtime = "nodejs";

function oauthError(error: OAuthProtocolError | { code: string; message: string }, status = 400) {
  return NextResponse.json(
    { error: error.code, error_description: error.message },
    { status, headers: { "Cache-Control": "no-store" } },
  );
}

/**
 * The single OAuth token endpoint, serving both grants this server implements.
 *
 * Nothing here ever logs a token, code, secret or PKCE verifier: audit records
 * carry identifiers and outcomes only.
 */
export async function POST(request: NextRequest) {
  const contentType = request.headers.get("content-type") ?? "";
  if (!contentType.includes("application/x-www-form-urlencoded")) {
    return oauthError({ code: "invalid_request", message: "Use application/x-www-form-urlencoded." });
  }
  const body = await request.formData();
  const field = (key: string) => {
    const value = body.get(key);
    return typeof value === "string" && value.length > 0 ? value : null;
  };
  const grantType = body.get("grant_type");
  const resource = field("resource");
  const expectedResource = `${publicOrigin(request)}/api/mcp`;

  if (!resource || resource !== expectedResource) {
    return oauthError({ code: "invalid_target", message: `resource must be ${expectedResource}.` });
  }

  try {
    if (grantType === "authorization_code") {
      const clientId = body.get("client_id");
      const code = body.get("code");
      const redirectUri = body.get("redirect_uri");
      const codeVerifier = body.get("code_verifier");
      const clientSecret = body.get("client_secret");
      if (
        typeof clientId !== "string" ||
        typeof code !== "string" ||
        typeof redirectUri !== "string" ||
        typeof codeVerifier !== "string" ||
        (clientSecret !== null && typeof clientSecret !== "string")
      ) {
        return oauthError({ code: "invalid_request", message: "Invalid authorization-code exchange request." });
      }
      const token = await exchangeAuthorizationCode({
        clientId,
        code,
        redirectUri,
        codeVerifier,
        clientSecret: clientSecret ?? undefined,
        resource,
      });

      if (token.refreshToken) {
        await writeAuditLog({
          actorType: "system",
          action: "mcp.refresh_token.issued",
          entityType: "external_client",
          entityId: clientId,
          details: { scopes: token.scopes, expiresAt: token.refreshTokenExpiresAt?.toISOString() },
        });
      }

      return NextResponse.json(
        {
          access_token: token.accessToken,
          token_type: "Bearer",
          expires_in: Math.max(0, Math.floor((token.expiresAt.getTime() - Date.now()) / 1_000)),
          scope: token.scopes.join(" "),
          ...(token.refreshToken ? { refresh_token: token.refreshToken } : {}),
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    if (grantType === "refresh_token") {
      const clientId = body.get("client_id");
      const refreshToken = body.get("refresh_token");
      const clientSecret = body.get("client_secret");
      if (typeof clientId !== "string" || typeof refreshToken !== "string") {
        return oauthError({ code: "invalid_request", message: "client_id and refresh_token are required." });
      }

      const outcome = await exchangeRefreshToken({
        clientId,
        clientSecret: typeof clientSecret === "string" ? clientSecret : undefined,
        refreshToken,
        scope: field("scope"),
        resource,
      });

      if (outcome.kind === "replay") {
        // The family is already revoked by this point. Surfaced as
        // invalid_grant per RFC 6749; the detail lives in the audit record.
        await writeAuditLog({
          actorType: "system",
          action: "mcp.refresh_token.replay_detected",
          entityType: "external_client",
          entityId: clientId,
          details: { familyId: outcome.familyId, outcome: "family_revoked, reauthorization required" },
        });
        return oauthError({
          code: "invalid_grant",
          message: "Refresh token was already used. The session has been revoked; reauthorize.",
        });
      }

      await writeAuditLog({
        userId: outcome.userId,
        actorType: "system",
        action: "mcp.refresh_token.rotated",
        entityType: "external_client",
        entityId: outcome.clientId,
        details: { familyId: outcome.familyId, scopes: outcome.tokens.scopes },
      });

      return NextResponse.json(
        {
          access_token: outcome.tokens.accessToken,
          token_type: "Bearer",
          expires_in: Math.max(0, Math.floor((outcome.tokens.expiresAt.getTime() - Date.now()) / 1_000)),
          scope: outcome.tokens.scopes.join(" "),
          refresh_token: outcome.tokens.refreshToken,
        },
        { headers: { "Cache-Control": "no-store" } },
      );
    }

    return oauthError({
      code: "unsupported_grant_type",
      message: `Unsupported grant_type. This server supports authorization_code and refresh_token.`,
    });
  } catch (error) {
    if (error instanceof OAuthProtocolError) {
      if (grantType === "refresh_token") {
        await writeAuditLog({
          actorType: "system",
          action: "mcp.refresh_token.rejected",
          entityType: "external_client",
          entityId: typeof body.get("client_id") === "string" ? (body.get("client_id") as string) : "unknown",
          details: { error: error.code, reason: error.message },
        }).catch(() => undefined);
      }
      return oauthError(error);
    }
    return NextResponse.json({ error: "server_error", error_description: "Unable to issue access token." }, { status: 500 });
  }
}
