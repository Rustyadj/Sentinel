import { authorizationServerMetadata } from "@/lib/mcp/oauth";

// RFC 8414. ChatGPT fetches this before it will attempt an OAuth flow, so it
// must be reachable without authentication and served from the site root.
export const dynamic = "force-dynamic";

export async function GET() {
  return Response.json(authorizationServerMetadata(), {
    headers: { "Cache-Control": "public, max-age=300", "Access-Control-Allow-Origin": "*" },
  });
}
