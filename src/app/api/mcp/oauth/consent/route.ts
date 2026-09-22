import { db } from "@/lib/db";
import { requireUser } from "@/lib/current-user";
import { oauthErrorResponse, OAuthError } from "@/lib/mcp/errors";
import { denialRedirect, issueAuthorizationCode, resolveAuthorizeRequest } from "@/lib/mcp/oauth";
import { parseScopeString, type McpScope } from "@/lib/mcp/scopes";
import { prismaStore } from "@/lib/mcp/store";

/**
 * Where the consent form at /mcp/authorize posts.
 *
 * The whole request is re-resolved here from the form's own fields rather than
 * trusted from any server-side scratch state: the client_id, redirect_uri and
 * PKCE challenge are validated again against the registered client before a
 * code is minted, so a tampered form cannot redirect a code anywhere the
 * client never registered.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser();
    const form = await request.formData();
    const field = (key: string) => {
      const value = form.get(key);
      return typeof value === "string" && value.length > 0 ? value : null;
    };

    const clientId = field("client_id");
    const redirectUri = field("redirect_uri");
    if (!clientId || !redirectUri) throw new OAuthError("invalid_request", "client_id and redirect_uri are required.");

    const resolved = await resolveAuthorizeRequest(prismaStore(db), {
      clientId,
      redirectUri,
      scope: field("scope"),
      codeChallenge: field("code_challenge"),
      codeChallengeMethod: field("code_challenge_method"),
      state: field("state"),
      resource: field("resource"),
    });

    if (field("decision") !== "approve") {
      return Response.redirect(denialRedirect(resolved), 303);
    }

    // Checkbox values, not the requested list — the human may untick any of them.
    const approvedScopes = form.getAll("approved_scope").filter((value): value is string => typeof value === "string");
    const workspaceId = field("workspace_id");
    if (!workspaceId) throw new OAuthError("access_denied", "A workspace is required.");

    // The workspace selector is untrusted form input. Re-check membership at
    // submission time so a forged POST cannot mint a grant for another tenant.
    const workspace = await db.workspace.findFirst({
      where: {
        id: workspaceId,
        OR: [{ ownerId: user.id }, { roleAssignments: { some: { userId: user.id } } }],
      },
      select: { id: true },
    });
    if (!workspace) throw new OAuthError("access_denied", "You do not have access to that workspace.");

    const { redirectTo } = await issueAuthorizationCode(prismaStore(db), resolved, {
      userId: user.id,
      workspaceId,
      approvedScopes: parseScopeString(approvedScopes.join(" ")) as McpScope[],
    });
    return Response.redirect(redirectTo, 303);
  } catch (error) {
    if (error instanceof Error && error.message === "Unauthorized") {
      return Response.json({ error: "access_denied", error_description: "Sign in first." }, { status: 401 });
    }
    return oauthErrorResponse(error);
  }
}
