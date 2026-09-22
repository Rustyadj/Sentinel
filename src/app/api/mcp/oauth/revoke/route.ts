import { db } from "@/lib/db";
import { hashToken } from "@/lib/mcp/tokens";
import { prismaStore } from "@/lib/mcp/store";

/**
 * RFC 7009. Revoking kills the grant, which kills every access token issued
 * under it — access tokens carry the grant id and it is loaded on every call.
 *
 * Per the RFC this always answers 200, including for an unknown token: a
 * distinguishable response would turn the endpoint into a token oracle.
 */
export async function POST(request: Request) {
  const form = await request.formData().catch(() => null);
  const token = form?.get("token");
  if (typeof token === "string" && token.length > 0) {
    const store = prismaStore(db);
    const grant = await store.findGrantByRefreshHash(hashToken(token));
    if (grant) await store.revokeGrant(grant.id);
  }
  return new Response(null, { status: 200, headers: { "Cache-Control": "no-store" } });
}
