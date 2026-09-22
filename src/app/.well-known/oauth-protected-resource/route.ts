import { logDiscovery } from "@/lib/mcp/access-log";
import { protectedResourceMetadata } from "@/lib/mcp/oauth";

// RFC 9728 — the document the 401 from /api/mcp points at, telling a client
// which authorization server protects this resource.
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  logDiscovery(request, "/.well-known/oauth-protected-resource");
  return Response.json(protectedResourceMetadata(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
