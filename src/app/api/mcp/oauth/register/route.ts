import { db } from "@/lib/db";
import { oauthErrorResponse, OAuthError } from "@/lib/mcp/errors";
import { registerClient } from "@/lib/mcp/oauth";
import { prismaStore } from "@/lib/mcp/store";

/**
 * RFC 7591 dynamic client registration.
 *
 * Open registration is what lets ChatGPT add this connector without an
 * operator pre-provisioning credentials. It is safe because registration
 * grants nothing on its own: a registered client still cannot read a byte
 * until a signed-in human approves it at /mcp/authorize, and the scopes it
 * asks for here are only a ceiling on what may be consented to.
 */
export async function POST(request: Request) {
  try {
    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new OAuthError("invalid_request", "Body must be JSON.");
    }
    const registration = await registerClient(prismaStore(db), body as Record<string, unknown>);
    return Response.json(registration, { status: 201 });
  } catch (error) {
    return oauthErrorResponse(error);
  }
}
