import { db } from "@/lib/db";
import { OAuthError, oauthErrorResponse } from "@/lib/mcp/errors";
import { exchangeAuthorizationCode, exchangeRefreshToken, issuerUrl } from "@/lib/mcp/oauth";
import { prismaStore } from "@/lib/mcp/store";

/**
 * RFC 6749 token endpoint, restricted to the two OAuth 2.1 grants:
 * authorization_code (with PKCE) and refresh_token.
 */
export async function POST(request: Request) {
  try {
    const form = await request.formData().catch(() => null);
    if (!form) throw new OAuthError("invalid_request", "Body must be application/x-www-form-urlencoded.");
    const field = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" && value.length > 0 ? value : null;
    };

    // HTTP Basic is the RFC's preferred client authentication; body fields are
    // the fallback most MCP clients actually send.
    let clientId = field("client_id");
    let clientSecret = field("client_secret");
    const authorization = request.headers.get("authorization");
    if (authorization?.startsWith("Basic ")) {
      const decoded = Buffer.from(authorization.slice("Basic ".length), "base64").toString("utf8");
      const separator = decoded.indexOf(":");
      if (separator > 0) {
        clientId = decodeURIComponent(decoded.slice(0, separator));
        clientSecret = decodeURIComponent(decoded.slice(separator + 1));
      }
    }

    const store = prismaStore(db);
    const grantType = field("grant_type");
    const resource = field("resource");
    if (resource && resource !== `${issuerUrl()}/api/mcp`) {
      throw new OAuthError("invalid_request", "resource does not identify this MCP server.");
    }

    const tokens =
      grantType === "authorization_code"
        ? await exchangeAuthorizationCode(store, {
            clientId,
            clientSecret,
            code: field("code"),
            redirectUri: field("redirect_uri"),
            codeVerifier: field("code_verifier"),
          })
        : grantType === "refresh_token"
          ? await exchangeRefreshToken(store, { clientId, clientSecret, refreshToken: field("refresh_token") })
          : null;

    if (!tokens) {
      throw new OAuthError("unsupported_grant_type", `Unsupported grant_type "${grantType ?? ""}".`);
    }

    // Tokens must never be cached by an intermediary.
    return Response.json(tokens, { headers: { "Cache-Control": "no-store", Pragma: "no-cache" } });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
